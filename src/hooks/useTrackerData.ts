import { useEffect, useRef, useState } from 'react';
import { CDItem, Shipment, ShipmentStatus } from '@/types/tracker';
import { generatePackageName } from '@/lib/calculations';
import { INITIAL_SHIPMENTS } from '@/lib/seedData';

export const STORAGE_KEY_SHIPMENTS = 'cd_import_tracker_shipments_v1';
export const STORAGE_KEY_CDS = 'cd_import_tracker_items_v1';
export const STORAGE_KEY_UPDATED_AT = 'cd_import_tracker_updated_at_v1';
export const STORAGE_KEY_CONSOLIDATED_MIGRATION = 'cd_import_tracker_migrated_consolidated_v1';
export const STORAGE_KEY_LEGACY_OWNER = 'cd_import_tracker_legacy_owner_v1';

export function normalizeConsolidatedState(
  shipmentsList: Shipment[],
  cdItemsList: CDItem[],
  forceMigrate: boolean = false
): { shipments: Shipment[]; cdItems: CDItem[]; changed: boolean } {
  const consolidatedIds = new Set<string>();
  let changed = false;

  const nextShipments = shipmentsList.map((s) => {
    const items = cdItemsList.filter((cd) => cd.shipmentId === s.id);
    const autoName = s.isCustomName ? s.name : generatePackageName(items, s.name);

    let updatedShipment = s;
    if (autoName !== s.name) {
      changed = true;
      updatedShipment = { ...updatedShipment, name: autoName };
    }

    const hasConsolidationIndicators =
      updatedShipment.consolidationMode === 'group_only' ||
      updatedShipment.consolidationMode === 'unpack_and_repack' ||
      (forceMigrate &&
        (Number(updatedShipment.forwarderFee) > 0 ||
          Number(updatedShipment.internationalShipping) > 0));

    if (
      (updatedShipment.status === 'comprado' ||
        updatedShipment.status === 'no_redirecionador') &&
      hasConsolidationIndicators
    ) {
      changed = true;
      consolidatedIds.add(updatedShipment.id);
      return { ...updatedShipment, status: 'consolidado' as ShipmentStatus };
    }

    if (
      updatedShipment.status === 'consolidado' ||
      updatedShipment.status === 'em_transito' ||
      updatedShipment.status === 'tributado' ||
      updatedShipment.status === 'entregue'
    ) {
      consolidatedIds.add(updatedShipment.id);
    }

    return updatedShipment;
  });

  const nextCdItems = cdItemsList.map((cd) => {
    if (consolidatedIds.has(cd.shipmentId) && !cd.isConsolidated) {
      changed = true;
      return { ...cd, isConsolidated: true };
    }
    return cd;
  });

  return { shipments: nextShipments, cdItems: nextCdItems, changed };
}

interface UseTrackerDataProps {
  isAuthLoaded: boolean;
  isSignedIn: boolean;
  currentUserId: string | null;
}

export function useTrackerData({
  isAuthLoaded,
  isSignedIn,
  currentUserId,
}: UseTrackerDataProps) {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [cdItems, setCdItems] = useState<CDItem[]>([]);
  const [selectedShipmentId, setSelectedShipmentId] = useState<string>('');
  const [isHydrated, setIsHydrated] = useState(false);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<
    'synced' | 'saving' | 'error'
  >('synced');

  const isSyncingFromServerRef = useRef(false);
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncAbortRef = useRef<AbortController | null>(null);
  const lastSyncedPayloadRef = useRef<string>('');

  const isOnlyDefaultSeed = (list: Shipment[]) => {
    if (list.length === 0) return true;
    const seedIds = new Set(INITIAL_SHIPMENTS.map((s) => s.id));
    return list.every((s) => seedIds.has(s.id));
  };

  const performServerSync = async (
    shipmentsToSave: Shipment[],
    cdsToSave: CDItem[],
    userUpdatedAtKey: string
  ) => {
    const serializedBody = JSON.stringify({
      shipments: shipmentsToSave,
      cdItems: cdsToSave,
    });
    if (serializedBody === lastSyncedPayloadRef.current) {
      setCloudSyncStatus('synced');
      return;
    }

    if (syncAbortRef.current) {
      syncAbortRef.current.abort();
    }
    const controller = new AbortController();
    syncAbortRef.current = controller;

    setCloudSyncStatus('saving');
    try {
      const r = await fetch('/api/tracker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: serializedBody,
        signal: controller.signal,
      });
      if (r.ok) {
        const data = await r.json();
        lastSyncedPayloadRef.current = serializedBody;
        if (data?.updatedAt) {
          localStorage.setItem(userUpdatedAtKey, data.updatedAt);
        }
        setCloudSyncStatus('synced');
      } else {
        setCloudSyncStatus('error');
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      setCloudSyncStatus('error');
    }
  };

  // Carrega dados sincronizando LocalStorage (isolado por userId) com o servidor (/api/tracker)
  useEffect(() => {
    if (!isAuthLoaded) return;
    if (!isSignedIn || !currentUserId) {
      setShipments([]);
      setCdItems([]);
      setSelectedShipmentId('');
      setIsHydrated(false);
      return;
    }

    let cancelled = false;
    setIsHydrated(false);

    const userShipmentsKey = `${STORAGE_KEY_SHIPMENTS}_${currentUserId}`;
    const userCdsKey = `${STORAGE_KEY_CDS}_${currentUserId}`;
    const userUpdatedAtKey = `${STORAGE_KEY_UPDATED_AT}_${currentUserId}`;
    const userMigrationKey = `${STORAGE_KEY_CONSOLIDATED_MIGRATION}_${currentUserId}`;

    const initData = async () => {
      let localShipments: Shipment[] | null = null;
      let localCDs: CDItem[] | null = null;
      let localUpdatedAt: string | null = null;
      const alreadyMigrated =
        typeof window !== 'undefined' &&
        localStorage.getItem(userMigrationKey) === '1';

      try {
        let savedShipments = localStorage.getItem(userShipmentsKey);
        let savedCDs = localStorage.getItem(userCdsKey);
        localUpdatedAt = localStorage.getItem(userUpdatedAtKey);

        if (!savedShipments || !savedCDs) {
          const legacyOwner = localStorage.getItem(STORAGE_KEY_LEGACY_OWNER);
          const legacyShipments = localStorage.getItem(STORAGE_KEY_SHIPMENTS);
          const legacyCDs = localStorage.getItem(STORAGE_KEY_CDS);
          if (!legacyOwner && legacyShipments && legacyCDs) {
            localStorage.setItem(STORAGE_KEY_LEGACY_OWNER, currentUserId);
            savedShipments = legacyShipments;
            savedCDs = legacyCDs;
          }
        }

        if (savedShipments && savedCDs) {
          const parsedShipments: Shipment[] = JSON.parse(savedShipments);
          const parsedCDs: CDItem[] = JSON.parse(savedCDs);
          const normalized = normalizeConsolidatedState(
            parsedShipments,
            parsedCDs,
            !alreadyMigrated
          );
          localShipments = normalized.shipments;
          localCDs = normalized.cdItems;
          if (!alreadyMigrated) {
            localStorage.setItem(userMigrationKey, '1');
          }
        }
      } catch {
        // ignora
      }

      const localHasRealData =
        localShipments &&
        localCDs &&
        localShipments.length > 0 &&
        !isOnlyDefaultSeed(localShipments);

      if (localShipments && localCDs && !cancelled) {
        setShipments(localShipments);
        setCdItems(localCDs);
        setSelectedShipmentId(localShipments[0]?.id || '');
      }

      try {
        const res = await fetch('/api/tracker', { cache: 'no-store' });
        if (res.ok) {
          const serverData = await res.json();
          const serverHasRealData =
            serverData.exists &&
            Array.isArray(serverData.shipments) &&
            Array.isArray(serverData.cdItems) &&
            !isOnlyDefaultSeed(serverData.shipments);

          if (localHasRealData && !serverHasRealData) {
            const postRes = await fetch('/api/tracker', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                shipments: localShipments,
                cdItems: localCDs,
              }),
            });
            if (postRes.ok) {
              const postData = await postRes.json();
              if (postData?.updatedAt) {
                localStorage.setItem(userUpdatedAtKey, postData.updatedAt);
              }
              setCloudSyncStatus('synced');
            }
          } else if (
            serverData.exists &&
            (!localHasRealData || serverHasRealData)
          ) {
            const normalizedServer = normalizeConsolidatedState(
              serverData.shipments,
              serverData.cdItems,
              !alreadyMigrated
            );
            const serverTimestamp = serverData.updatedAt
              ? new Date(serverData.updatedAt).getTime()
              : 0;
            const localTimestamp = localUpdatedAt
              ? new Date(localUpdatedAt).getTime()
              : 0;

            const preferLocal =
              Boolean(localHasRealData && localShipments && localCDs) &&
              localTimestamp > 0 &&
              serverTimestamp > 0 &&
              localTimestamp > serverTimestamp;

            const chosenShipments =
              preferLocal && localShipments
                ? localShipments
                : normalizedServer.shipments;
            const chosenCDs =
              preferLocal && localCDs ? localCDs : normalizedServer.cdItems;

            if (!cancelled) {
              isSyncingFromServerRef.current =
                !preferLocal && !normalizedServer.changed;
              setShipments(chosenShipments);
              setCdItems(chosenCDs);
              setSelectedShipmentId((prev) =>
                chosenShipments.some((s: Shipment) => s.id === prev)
                  ? prev
                  : chosenShipments[0]?.id || ''
              );
              localStorage.setItem(
                userShipmentsKey,
                JSON.stringify(chosenShipments)
              );
              localStorage.setItem(userCdsKey, JSON.stringify(chosenCDs));
              if (preferLocal && localShipments && localCDs) {
                await performServerSync(
                  localShipments,
                  localCDs,
                  userUpdatedAtKey
                );
              } else if (serverData.updatedAt) {
                localStorage.setItem(userUpdatedAtKey, serverData.updatedAt);
              }
              localStorage.setItem(userMigrationKey, '1');
              setCloudSyncStatus('synced');
            }
          } else if (!localShipments || !localCDs) {
            if (!cancelled) {
              setShipments([]);
              setCdItems([]);
              setSelectedShipmentId('');
            }
          }
        }
      } catch {
        if (!localShipments && !cancelled) {
          setShipments([]);
          setCdItems([]);
          setSelectedShipmentId('');
        }
      } finally {
        if (!cancelled) {
          setIsHydrated(true);
        }
      }
    };

    initData();
    return () => {
      cancelled = true;
    };
  }, [isAuthLoaded, isSignedIn, currentUserId]);

  // Revalidação periódica suave da nuvem a cada 30 minutos e ao alternar de volta para a aba
  useEffect(() => {
    if (!isHydrated || !isSignedIn || !currentUserId) return;

    let isChecking = false;
    const checkForRemoteUpdates = async () => {
      if (isChecking) return;
      isChecking = true;
      try {
        const res = await fetch('/api/tracker', { cache: 'no-store' });
        if (!res.ok) return;
        const serverData = await res.json();
        if (
          !serverData.exists ||
          !Array.isArray(serverData.shipments) ||
          !Array.isArray(serverData.cdItems) ||
          isOnlyDefaultSeed(serverData.shipments)
        ) {
          return;
        }

        const userUpdatedAtKey = `${STORAGE_KEY_UPDATED_AT}_${currentUserId}`;
        const localUpdatedAt = localStorage.getItem(userUpdatedAtKey);
        const serverTimestamp = serverData.updatedAt
          ? new Date(serverData.updatedAt).getTime()
          : 0;
        const localTimestamp = localUpdatedAt
          ? new Date(localUpdatedAt).getTime()
          : 0;

        if (serverTimestamp > localTimestamp) {
          const userMigrationKey = `${STORAGE_KEY_CONSOLIDATED_MIGRATION}_${currentUserId}`;
          const alreadyMigrated =
            typeof window !== 'undefined' &&
            localStorage.getItem(userMigrationKey) === '1';

          const normalizedServer = normalizeConsolidatedState(
            serverData.shipments,
            serverData.cdItems,
            !alreadyMigrated
          );

          isSyncingFromServerRef.current = !normalizedServer.changed;
          setShipments(normalizedServer.shipments);
          setCdItems(normalizedServer.cdItems);

          const userShipmentsKey = `${STORAGE_KEY_SHIPMENTS}_${currentUserId}`;
          const userCdsKey = `${STORAGE_KEY_CDS}_${currentUserId}`;
          localStorage.setItem(
            userShipmentsKey,
            JSON.stringify(normalizedServer.shipments)
          );
          localStorage.setItem(
            userCdsKey,
            JSON.stringify(normalizedServer.cdItems)
          );
          if (serverData.updatedAt) {
            localStorage.setItem(userUpdatedAtKey, serverData.updatedAt);
          }
          setCloudSyncStatus('synced');
        }
      } catch {
        // silencioso
      } finally {
        isChecking = false;
      }
    };

    const intervalTimer = setInterval(checkForRemoteUpdates, 30 * 60 * 1000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkForRemoteUpdates();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(intervalTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isHydrated, isSignedIn, currentUserId]);

  // Mantém o Nome Identificador de todos os pacotes sincronizado automaticamente
  useEffect(() => {
    if (!isHydrated) return;
    setShipments((prev) => {
      let anyChanged = false;
      const updated = prev.map((s) => {
        if (s.isCustomName) return s;
        const itemsForShip = cdItems.filter((cd) => cd.shipmentId === s.id);
        if (itemsForShip.length === 0) return s;
        const expectedName = generatePackageName(itemsForShip, s.name);
        if (expectedName !== s.name) {
          anyChanged = true;
          return { ...s, name: expectedName };
        }
        return s;
      });
      return anyChanged ? updated : prev;
    });
  }, [cdItems, isHydrated]);

  // Salva imediatamente no LocalStorage e com debounce de 700ms no Servidor
  useEffect(() => {
    if (!isHydrated || !isSignedIn || !currentUserId) return;
    const userShipmentsKey = `${STORAGE_KEY_SHIPMENTS}_${currentUserId}`;
    const userCdsKey = `${STORAGE_KEY_CDS}_${currentUserId}`;
    const userUpdatedAtKey = `${STORAGE_KEY_UPDATED_AT}_${currentUserId}`;

    localStorage.setItem(userShipmentsKey, JSON.stringify(shipments));
    localStorage.setItem(userCdsKey, JSON.stringify(cdItems));

    if (isSyncingFromServerRef.current) {
      isSyncingFromServerRef.current = false;
      lastSyncedPayloadRef.current = JSON.stringify({
        shipments,
        cdItems,
      });
      return;
    }

    const nowIso = new Date().toISOString();
    localStorage.setItem(userUpdatedAtKey, nowIso);
    setCloudSyncStatus('saving');

    if (saveDebounceRef.current) {
      clearTimeout(saveDebounceRef.current);
    }

    saveDebounceRef.current = setTimeout(() => {
      performServerSync(shipments, cdItems, userUpdatedAtKey);
    }, 700);

    return () => {
      if (saveDebounceRef.current) {
        clearTimeout(saveDebounceRef.current);
      }
    };
  }, [shipments, cdItems, isHydrated, isSignedIn, currentUserId]);

  const forceSync = () => {
    if (!currentUserId) return;
    const userUpdatedAtKey = `${STORAGE_KEY_UPDATED_AT}_${currentUserId}`;
    performServerSync(shipments, cdItems, userUpdatedAtKey);
  };

  return {
    shipments,
    setShipments,
    cdItems,
    setCdItems,
    selectedShipmentId,
    setSelectedShipmentId,
    isHydrated,
    cloudSyncStatus,
    setCloudSyncStatus,
    forceSync,
  };
}
