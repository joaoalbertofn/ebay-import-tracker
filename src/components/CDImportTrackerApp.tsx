'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SignInButton, UserButton, useUser } from '@clerk/nextjs';
import {
  CDItem,
  CalculatedCDItem,
  Shipment,
  ShipmentCalculationSummary,
  ShipmentStatus,
} from '@/types/tracker';
import {
  CURRENCY_META,
  MG_TAX_FACTOR,
  calculateShipmentSummary,
  formatBrl,
  formatOriginalCurrency,
  formatWeightKg,
  generatePackageName,
  getItemUnitInternalShipping,
} from '@/lib/calculations';
import { fetchBestAlbumCover } from '@/lib/coverArt';
import { INITIAL_SHIPMENTS } from '@/lib/seedData';
import {
  AbsorbedForwarderItemsPayload,
  ForwarderPackageOption,
  InitialBundlePayload,
  ShipmentModal,
  STATUS_LABELS,
} from '@/components/ShipmentModal';
import { CDModal } from '@/components/CDModal';
import {
  Disc3,
  Package,
  Plus,
  Search,
  Sparkles,
  Copy,
  Trash2,
  Edit3,
  Truck,
  Download,
  Upload,
  Layers,
  Calendar,
  ArrowUpDown,
  CheckCircle2,
  ExternalLink,
  Info,
  Receipt,
  Box,
  Image as ImageIcon,
  Loader2,
  PackageOpen,
  PackageCheck,
  ArrowLeft,
  ChevronRight,
  RotateCcw,
  LogIn,
  Cloud,
  CloudOff,
  Lock,
  Unlock,
  Scale,
  AlertTriangle,
  Check,
  X,
} from 'lucide-react';

const STORAGE_KEY_SHIPMENTS = 'cd_import_tracker_shipments_v1';
const STORAGE_KEY_CDS = 'cd_import_tracker_cds_v1';
const STORAGE_KEY_UPDATED_AT = 'cd_import_tracker_updated_at_v1';
const STORAGE_KEY_CONSOLIDATED_MIGRATION =
  'cd_import_tracker_consolidated_mig_v3';
const STORAGE_KEY_LEGACY_OWNER = 'cd_import_tracker_legacy_owner_v1';

interface ConfirmDialogState {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
}

function formatShortBundleBadge(
  item: CDItem,
  currentShipmentName: string
): string {
  const qty = item.bundleTotalQuantity || 1;
  const rawName = (item.bundleName || '').trim();
  if (
    !rawName ||
    rawName === currentShipmentName ||
    rawName.startsWith('[Lote]') ||
    rawName.startsWith('[CD Individual]')
  ) {
    return `Lote (1/${qty})`;
  }
  const shortName =
    rawName.length > 18 ? `${rawName.slice(0, 18).trim()}…` : rawName;
  return `${shortName} (1/${qty})`;
}

function normalizeConsolidatedState(
  shipmentsList: Shipment[],
  cdItemsList: CDItem[],
  forceMigrate: boolean
): { shipments: Shipment[]; cdItems: CDItem[]; changed: boolean } {
  let changed = false;
  const consolidatedIds = new Set<string>();

  const nextShipments = shipmentsList.map((s) => {
    const itemsOfShipment = cdItemsList.filter((cd) => cd.shipmentId === s.id);
    const autoName =
      !s.isCustomName && itemsOfShipment.length > 0
        ? generatePackageName(itemsOfShipment, s.name)
        : s.name;

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

export default function CDImportTrackerApp() {
  const { isLoaded: isAuthLoaded, isSignedIn, user } = useUser();
  const currentUserId = user?.id || null;

  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [cdItems, setCdItems] = useState<CDItem[]>([]);
  const [selectedShipmentId, setSelectedShipmentId] = useState<string>('');
  const [isHydrated, setIsHydrated] = useState(false);

  // Status de Sincronização em Nuvem (Upstash / API)
  const [cloudSyncStatus, setCloudSyncStatus] = useState<
    'synced' | 'saving' | 'error'
  >('synced');

  // Aba principal: 'packages' (Master/Detail por pacotes) ou 'collection' (Visão Global de todos os CDs)
  const [activeMainTab, setActiveMainTab] = useState<'packages' | 'collection'>(
    'packages'
  );

  // Navegação estilo App Nativo no Mobile ('list' = Lista de Pacotes, 'detail' = Detalhes do Pacote)
  const [mobileActivePane, setMobileActivePane] = useState<'list' | 'detail'>(
    'list'
  );

  // Busca e Ordenação (Aba Pacotes)
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ShipmentStatus | 'ALL'>(
    'ALL'
  );
  const [cdSortBy, setCdSortBy] = useState<
    'created' | 'artist' | 'cost_desc' | 'cost_asc'
  >('created');

  // Busca e Ordenação (Aba Visão Global da Coleção)
  const [collectionSearch, setCollectionSearch] = useState('');
  const [collectionStatusFilter, setCollectionStatusFilter] = useState<
    ShipmentStatus | 'ALL'
  >('ALL');
  const [collectionSortBy, setCollectionSortBy] = useState<
    'artist' | 'album' | 'cost_asc' | 'cost_desc' | 'recent'
  >('artist');

  // Modais
  const [isShipmentModalOpen, setIsShipmentModalOpen] = useState(false);
  const [editingShipment, setEditingShipment] = useState<Shipment | null>(null);

  const [isCDModalOpen, setIsCDModalOpen] = useState(false);
  const [editingCD, setEditingCD] = useState<CDItem | null>(null);

  // Modal de Confirmação Customizado (substitui window.confirm)
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    isOpen: false,
    title: '',
    description: '',
    confirmLabel: 'Confirmar',
    onConfirm: () => {},
  });

  // Edição rápida (inline) do nome do pacote e do peso no cabeçalho de detalhes
  const [isEditingPackageTitle, setIsEditingPackageTitle] = useState(false);
  const [packageTitleDraft, setPackageTitleDraft] = useState('');
  const [isEditingPackageWeight, setIsEditingPackageWeight] = useState(false);
  const [packageWeightDraft, setPackageWeightDraft] = useState('');

  // Edição rápida (inline) do nome do álbum direto na tabela ou no card mobile
  const [inlineEditingId, setInlineEditingId] = useState<string | null>(null);
  const [inlineArtist, setInlineArtist] = useState('');
  const [inlineAlbum, setInlineAlbum] = useState('');
  const [isFetchingCoversBatch, setIsFetchingCoversBatch] = useState(false);

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isSyncingFromServerRef = useRef(false);
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3800);
  };

  const isOnlyDefaultSeed = (list: Shipment[]) => {
    if (list.length === 0) return true;
    const seedIds = new Set(INITIAL_SHIPMENTS.map((s) => s.id));
    return list.every((s) => seedIds.has(s.id));
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

        // Se ainda não há cache local para este userId, verifica se o cache legado pertence ao primeiro usuário
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
        // ignora erro de leitura local
      }

      const localHasRealData =
        localShipments &&
        localCDs &&
        localShipments.length > 0 &&
        !isOnlyDefaultSeed(localShipments);

      // Mostra imediatamente os dados locais deste usuário se existirem
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
              if (!preferLocal && serverData.updatedAt) {
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

  // Mantém o Nome Identificador de todos os pacotes sincronizado automaticamente ([CD Individual] ou [Lote]),
  // respeitando pacotes com nome personalizado travado (isCustomName === true)
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

  const performServerSync = async (
    shipmentsToSave: Shipment[],
    cdsToSave: CDItem[],
    userUpdatedAtKey: string
  ) => {
    setCloudSyncStatus('saving');
    try {
      const r = await fetch('/api/tracker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shipments: shipmentsToSave,
          cdItems: cdsToSave,
        }),
      });
      if (r.ok) {
        const data = await r.json();
        if (data?.updatedAt) {
          localStorage.setItem(userUpdatedAtKey, data.updatedAt);
        }
        setCloudSyncStatus('synced');
      } else {
        setCloudSyncStatus('error');
      }
    } catch {
      setCloudSyncStatus('error');
    }
  };

  // Salva imediatamente no LocalStorage e com debounce de 700ms no Servidor (/api/tracker)
  useEffect(() => {
    if (!isHydrated || !isSignedIn || !currentUserId) return;
    const userShipmentsKey = `${STORAGE_KEY_SHIPMENTS}_${currentUserId}`;
    const userCdsKey = `${STORAGE_KEY_CDS}_${currentUserId}`;
    const userUpdatedAtKey = `${STORAGE_KEY_UPDATED_AT}_${currentUserId}`;

    localStorage.setItem(userShipmentsKey, JSON.stringify(shipments));
    localStorage.setItem(userCdsKey, JSON.stringify(cdItems));

    if (isSyncingFromServerRef.current) {
      isSyncingFromServerRef.current = false;
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

  // Busca automática de capas em background para uma lista de recém-criados
  const autoPopulateCoversForItems = async (itemsToFetch: CDItem[]) => {
    for (const item of itemsToFetch) {
      if (item.coverUrl) continue;
      if (item.albumTitle.startsWith('CD #')) continue;

      const best = await fetchBestAlbumCover(item.artist, item.albumTitle);
      if (best) {
        setCdItems((prev) =>
          prev.map((cd) =>
            cd.id === item.id
              ? {
                  ...cd,
                  coverUrl: best.coverUrl,
                  releaseYear: cd.releaseYear || best.releaseYear,
                }
              : cd
          )
        );
      }
    }
  };

  // Calcula os resumos de TODOS os pacotes reativamente
  const summariesMap = useMemo(() => {
    const map = new Map<string, ShipmentCalculationSummary>();
    for (const ship of shipments) {
      map.set(ship.id, calculateShipmentSummary(ship, cdItems));
    }
    return map;
  }, [shipments, cdItems]);

  const selectedSummary = useMemo(() => {
    if (!selectedShipmentId) return null;
    return summariesMap.get(selectedShipmentId) || null;
  }, [summariesMap, selectedShipmentId]);

  // Lista de CDs atuais do pacote que está sendo editado no ShipmentModal
  const editingShipmentItems = useMemo(() => {
    if (!editingShipment) return [];
    return cdItems.filter((cd) => cd.shipmentId === editingShipment.id);
  }, [editingShipment, cdItems]);

  // Lista de pacotes elegíveis para consolidação:
  // Inclui apenas pacotes com status 'comprado' (Pacote Único) ou 'no_redirecionador' (Avulso)
  // que ainda NÃO foram consolidados em nenhuma caixa.
  const forwarderPackages = useMemo<ForwarderPackageOption[]>(() => {
    return shipments
      .filter(
        (s) =>
          (s.status === 'comprado' || s.status === 'no_redirecionador') &&
          s.consolidationMode !== 'group_only' &&
          s.consolidationMode !== 'unpack_and_repack'
      )
      .map((s) => ({
        shipment: s,
        items: cdItems.filter(
          (cd) => cd.shipmentId === s.id && !cd.isConsolidated
        ),
      }))
      .filter((fp) => fp.items.length > 0);
  }, [shipments, cdItems]);

  // Botão para buscar todas as capas faltantes do pacote selecionado
  const handleFetchAllCoversInShipment = async () => {
    if (!selectedSummary) return;
    const targets = selectedSummary.items.filter(
      (item) => !item.coverUrl && !item.albumTitle.startsWith('CD #')
    );

    if (targets.length === 0) {
      showToast(
        'Para buscar as capas, clique no título do CD para digitar o nome do álbum!'
      );
      return;
    }

    setIsFetchingCoversBatch(true);
    try {
      let foundCount = 0;
      for (const item of targets) {
        const best = await fetchBestAlbumCover(item.artist, item.albumTitle);
        if (best) {
          foundCount++;
          setCdItems((prev) =>
            prev.map((cd) =>
              cd.id === item.id
                ? {
                    ...cd,
                    coverUrl: best.coverUrl,
                    releaseYear: cd.releaseYear || best.releaseYear,
                  }
                : cd
            )
          );
        }
      }
      showToast(
        foundCount > 0
          ? `${foundCount} capa(s) encontrada(s) automaticamente!`
          : 'Nenhuma capa nova encontrada. Verifique os nomes dos álbuns.'
      );
    } finally {
      setIsFetchingCoversBatch(false);
    }
  };

  // Salvar edição rápida (inline) do nome do álbum direto na linha/card e já buscar a capa!
  const handleSaveInlineEdit = async (item: CDItem) => {
    const newArtist = inlineArtist.trim() || item.artist;
    const newAlbum = inlineAlbum.trim() || item.albumTitle;
    setInlineEditingId(null);

    setCdItems((prev) =>
      prev.map((cd) =>
        cd.id === item.id
          ? { ...cd, artist: newArtist, albumTitle: newAlbum }
          : cd
      )
    );

    if (!newAlbum.startsWith('CD #')) {
      const best = await fetchBestAlbumCover(newArtist, newAlbum);
      if (best) {
        setCdItems((prev) =>
          prev.map((cd) =>
            cd.id === item.id
              ? {
                  ...cd,
                  artist: newArtist,
                  albumTitle: newAlbum,
                  coverUrl: best.coverUrl,
                  releaseYear: best.releaseYear || cd.releaseYear,
                }
              : cd
          )
        );
        showToast(`Álbum "${newAlbum}" salvo com capa automática!`);
        return;
      }
    }
    showToast(`Nome do álbum atualizado!`);
  };

  // Salvar edição inline do título do pacote (com trava isCustomName)
  const handleSavePackageTitleInline = (shipment: Shipment) => {
    const trimmed = packageTitleDraft.trim();
    setIsEditingPackageTitle(false);
    if (!trimmed) return;
    setShipments((prev) =>
      prev.map((s) =>
        s.id === shipment.id
          ? { ...s, name: trimmed, isCustomName: true }
          : s
      )
    );
    showToast('Nome personalizado do pacote salvo e travado!');
  };

  const handleTogglePackageCustomNameLock = (shipment: Shipment) => {
    const itemsOfShip = cdItems.filter((cd) => cd.shipmentId === shipment.id);
    if (shipment.isCustomName) {
      const autoName = generatePackageName(itemsOfShip, shipment.name);
      setShipments((prev) =>
        prev.map((s) =>
          s.id === shipment.id
            ? { ...s, isCustomName: false, name: autoName }
            : s
        )
      );
      showToast('Nome do pacote voltou para o modo Automático!');
    } else {
      setShipments((prev) =>
        prev.map((s) =>
          s.id === shipment.id ? { ...s, isCustomName: true } : s
        )
      );
      showToast('Nome do pacote travado como Personalizado!');
    }
  };

  // Filtra pacotes pela barra de busca global
  const filteredShipments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return shipments.filter((ship) => {
      if (statusFilter !== 'ALL' && ship.status !== statusFilter) {
        return false;
      }
      if (!q) return true;

      const matchShipment =
        ship.name.toLowerCase().includes(q) ||
        (ship.internationalTrackingCode || '').toLowerCase().includes(q) ||
        (ship.notes || '').toLowerCase().includes(q);

      if (matchShipment) return true;

      const shipCDs = cdItems.filter((cd) => cd.shipmentId === ship.id);
      return shipCDs.some(
        (cd) =>
          cd.artist.toLowerCase().includes(q) ||
          cd.albumTitle.toLowerCase().includes(q) ||
          (cd.localTrackingCode || '').toLowerCase().includes(q) ||
          (cd.bundleName || '').toLowerCase().includes(q)
      );
    });
  }, [shipments, cdItems, searchQuery, statusFilter]);

  // Métricas Globais do Topo do Dashboard
  const globalStats = useMemo(() => {
    let totalInvestedBrl = 0;
    let totalItems = 0;
    let totalPhysicalDiscs = 0;

    summariesMap.forEach((summary) => {
      totalInvestedBrl += summary.totalShipmentCostBrl;
      totalItems += summary.totalItemsCount;
      totalPhysicalDiscs += summary.totalPhysicalDiscsCount;
    });

    const avgPerItemBrl = totalItems > 0 ? totalInvestedBrl / totalItems : 0;
    const avgPerPhysicalDiscBrl =
      totalPhysicalDiscs > 0 ? totalInvestedBrl / totalPhysicalDiscs : 0;

    return {
      totalShipments: shipments.length,
      totalInvestedBrl,
      totalItems,
      totalPhysicalDiscs,
      avgPerItemBrl,
      avgPerPhysicalDiscBrl,
    };
  }, [summariesMap, shipments.length]);

  // Lista unificada de TODOS os CDs calculados (para a Aba "Todos os CDs da Coleção")
  const allCollectionEntries = useMemo(() => {
    const list: Array<{ item: CalculatedCDItem; shipment: Shipment }> = [];
    for (const ship of shipments) {
      const summary = summariesMap.get(ship.id);
      if (!summary) continue;
      for (const item of summary.items) {
        list.push({ item, shipment: ship });
      }
    }

    const q = collectionSearch.trim().toLowerCase();
    const filtered = list.filter(({ item, shipment }) => {
      if (
        collectionStatusFilter !== 'ALL' &&
        shipment.status !== collectionStatusFilter
      ) {
        return false;
      }
      if (!q) return true;
      return (
        item.artist.toLowerCase().includes(q) ||
        item.albumTitle.toLowerCase().includes(q) ||
        shipment.name.toLowerCase().includes(q) ||
        (item.localTrackingCode || '').toLowerCase().includes(q) ||
        (shipment.internationalTrackingCode || '').toLowerCase().includes(q)
      );
    });

    filtered.sort((a, b) => {
      if (collectionSortBy === 'artist') {
        return (
          a.item.artist.localeCompare(b.item.artist) ||
          a.item.albumTitle.localeCompare(b.item.albumTitle)
        );
      }
      if (collectionSortBy === 'album') {
        return a.item.albumTitle.localeCompare(b.item.albumTitle);
      }
      if (collectionSortBy === 'cost_asc') {
        return a.item.finalCostBrl - b.item.finalCostBrl;
      }
      if (collectionSortBy === 'cost_desc') {
        return b.item.finalCostBrl - a.item.finalCostBrl;
      }
      return (
        new Date(b.item.createdAt).getTime() -
        new Date(a.item.createdAt).getTime()
      );
    });

    return filtered;
  }, [
    shipments,
    summariesMap,
    collectionSearch,
    collectionStatusFilter,
    collectionSortBy,
  ]);

  // Lista de bundles existentes dentro do pacote selecionado
  const existingBundlesInSelected = useMemo(() => {
    if (!selectedSummary) return [];
    const seen = new Map<
      string,
      {
        bundleId: string;
        bundleName: string;
        bundleTotalValue: number;
        bundleTotalQuantity: number;
        bundleInternalShipping: number;
        localTrackingCode: string;
      }
    >();

    for (const item of selectedSummary.items) {
      if (item.isBundle && item.bundleId && !seen.has(item.bundleId)) {
        seen.set(item.bundleId, {
          bundleId: item.bundleId,
          bundleName: item.bundleName || 'Bundle',
          bundleTotalValue: item.bundleTotalValue || item.unitOriginalValue,
          bundleTotalQuantity: item.bundleTotalQuantity || 1,
          bundleInternalShipping: item.bundleInternalShipping || 0,
          localTrackingCode: item.localTrackingCode || '',
        });
      }
    }
    return Array.from(seen.values());
  }, [selectedSummary]);

  // Ordenação dos CDs na coluna da direita
  const displayedCDItems = useMemo(() => {
    if (!selectedSummary) return [];
    const list = [...selectedSummary.items];

    if (cdSortBy === 'artist') {
      list.sort((a, b) => a.artist.localeCompare(b.artist));
    } else if (cdSortBy === 'cost_desc') {
      list.sort((a, b) => b.finalCostBrl - a.finalCostBrl);
    } else if (cdSortBy === 'cost_asc') {
      list.sort((a, b) => a.finalCostBrl - b.finalCostBrl);
    }
    return list;
  }, [selectedSummary, cdSortBy]);

  // --- AÇÕES DE PACOTE (INCLUINDO EDIÇÃO DE CDs, CONSOLIDAÇÃO MULTIMOEDA E DESCARTE DE CDs) ---
  const handleSaveShipment = (
    data: Omit<Shipment, 'id' | 'createdAt'>,
    existingId?: string,
    initialBundle?: InitialBundlePayload,
    absorbedForwarder?: AbsorbedForwarderItemsPayload
  ) => {
    const now = Date.now();
    const targetShipmentId = existingId || `ship-${now}`;

    // 1. Processa novos CDs ou CDs editados dentro do modal do pacote
    let newlyCreatedCDs: CDItem[] = [];
    const updatedEntriesById = new Map<
      string,
      InitialBundlePayload['entries'][number]
    >();

    if (initialBundle && initialBundle.enabled) {
      const qty = Math.max(1, initialBundle.entries.length);
      const fallbackUnitVal = Number(
        (initialBundle.totalValue / qty).toFixed(4)
      );
      const hasDistinctPrices = initialBundle.entries.some(
        (e, _, arr) => e.unitPrice !== arr[0]?.unitPrice
      );
      const bundleId = `bundle-${now}`;

      initialBundle.entries.forEach((entry, idx) => {
        const cleanArtist = entry.artist.trim() || data.name;
        const cleanAlbum =
          entry.albumTitle.trim() ||
          (qty === 1 ? 'Álbum' : `CD #${idx + 1} do Lote (${data.name})`);
        const itemUnitVal =
          entry.unitPrice !== undefined
            ? Number(entry.unitPrice.toFixed(4))
            : fallbackUnitVal;

        if (entry.id) {
          updatedEntriesById.set(entry.id, {
            ...entry,
            artist: cleanArtist,
            albumTitle: cleanAlbum,
            unitPrice: itemUnitVal,
            discCount: entry.discCount || 1,
          });
        } else {
          newlyCreatedCDs.push({
            id: `cd-${now}-${idx}`,
            shipmentId: targetShipmentId,
            currency: data.currency,
            artist: cleanArtist,
            albumTitle: cleanAlbum,
            discCount: entry.discCount || 1,
            isBundle: qty > 1 && !hasDistinctPrices,
            bundleId: qty > 1 ? bundleId : undefined,
            bundleName: qty > 1 ? data.name : undefined,
            bundleTotalValue:
              qty > 1 && !hasDistinctPrices
                ? initialBundle.totalValue
                : undefined,
            bundleTotalQuantity: qty > 1 ? qty : undefined,
            bundleInternalShipping: 0,
            unitInternalShipping: 0,
            localTrackingCode: initialBundle.localTrackingCode || '',
            unitOriginalValue: itemUnitVal,
            coverUrl: entry.coverUrl,
            releaseYear: entry.releaseYear,
            createdAt: new Date(now + idx * 50).toISOString(),
          });
        }
      });
    }

    // 2. Processa os pacotes/CDs que estavam disponíveis para consolidação (incluídos ou descartados)
    const absorbedSet = new Set(absorbedForwarder?.selectedCdIds || []);
    const discardedSet = new Set(absorbedForwarder?.discardedCdIds || []);
    const isTargetConsolidated =
      absorbedSet.size > 0 ||
      data.status === 'consolidado' ||
      data.status === 'em_transito' ||
      data.status === 'tributado' ||
      data.status === 'entregue' ||
      data.consolidationMode === 'group_only' ||
      data.consolidationMode === 'unpack_and_repack';

    const resolvedData: Omit<Shipment, 'id' | 'createdAt'> = {
      ...data,
      status:
        absorbedSet.size > 0 &&
        (data.status === 'comprado' || data.status === 'no_redirecionador')
          ? 'consolidado'
          : data.status,
      consolidationMode:
        !isTargetConsolidated &&
        (data.status === 'comprado' || data.status === 'no_redirecionador')
          ? 'direct'
          : data.consolidationMode,
    };

    if (isTargetConsolidated) {
      newlyCreatedCDs = newlyCreatedCDs.map((cd) => ({
        ...cd,
        isConsolidated: true,
      }));
    }

    const packingHandlingVal: 'original_box' | 'unpacked' | undefined =
      absorbedForwarder
        ? absorbedForwarder.mode === 'unpack_and_repack'
          ? 'unpacked'
          : 'original_box'
        : undefined;

    const fullyAbsorbedShipmentIds = new Set<string>();
    const partiallyAbsorbedShippingRemaining = new Map<string, number>();

    // Mapa de ajustes por CD sobrevivente (redistribuição de descartados + fator de conversão de moeda)
    const survivorAdjustments = new Map<
      string,
      {
        extraUnitValueInSourceCurr: number;
        extraUnitShipInSourceCurr: number;
        newBundleQuantity?: number;
        conversionFactorToTarget: number;
      }
    >();

    const targetExchangeRate =
      Number(resolvedData.exchangeRate) ||
      CURRENCY_META[resolvedData.currency]?.defaultRate ||
      1;

    if (absorbedSet.size > 0 || discardedSet.size > 0) {
      for (const fp of forwarderPackages) {
        if (fp.shipment.id === targetShipmentId) continue;
        const discardedFromSource = fp.items.filter((cd) =>
          discardedSet.has(cd.id)
        );
        const keptInSource = fp.items.filter((cd) => !discardedSet.has(cd.id));
        const movedFromSource = keptInSource.filter((cd) =>
          absorbedSet.has(cd.id)
        );

        if (movedFromSource.length === 0 && discardedFromSource.length === 0) {
          continue;
        }

        const sourceExchangeRate =
          Number(fp.shipment.exchangeRate) ||
          CURRENCY_META[fp.shipment.currency]?.defaultRate ||
          1;
        const conversionFactor =
          fp.shipment.currency === resolvedData.currency
            ? 1
            : sourceExchangeRate / targetExchangeRate;

        // Redistribui o valor pago e o frete unitário dos CDs descartados entre os CDs mantidos daquele pacote/lote
        const discardedValueSum = discardedFromSource.reduce(
          (acc, cd) => acc + (Number(cd.unitOriginalValue) || 0),
          0
        );
        const discardedUnitShipSum = discardedFromSource.reduce(
          (acc, cd) => acc + getItemUnitInternalShipping(cd, cdItems),
          0
        );

        const extraUnitVal =
          keptInSource.length > 0 ? discardedValueSum / keptInSource.length : 0;
        const extraUnitShip =
          keptInSource.length > 0
            ? discardedUnitShipSum / keptInSource.length
            : 0;

        for (const keptCd of keptInSource) {
          survivorAdjustments.set(keptCd.id, {
            extraUnitValueInSourceCurr: extraUnitVal,
            extraUnitShipInSourceCurr: extraUnitShip,
            newBundleQuantity:
              discardedFromSource.length > 0 && keptCd.isBundle
                ? keptInSource.length
                : undefined,
            conversionFactorToTarget: conversionFactor,
          });
        }

        if (
          keptInSource.length === 0 ||
          movedFromSource.length >= keptInSource.length
        ) {
          fullyAbsorbedShipmentIds.add(fp.shipment.id);
        } else {
          const remainingRatio =
            (keptInSource.length - movedFromSource.length) /
            keptInSource.length;
          const remainingInternalShipping = Number(
            (
              (Number(fp.shipment.internalShipping) || 0) * remainingRatio
            ).toFixed(4)
          );
          partiallyAbsorbedShippingRemaining.set(
            fp.shipment.id,
            remainingInternalShipping
          );
        }
      }
    }

    // 3. Atualiza a lista de pacotes
    setShipments((prev) => {
      let nextList: Shipment[];
      if (existingId) {
        nextList = prev.map((s) =>
          s.id === existingId ? { ...s, ...resolvedData } : s
        );
      } else {
        const newShipment: Shipment = {
          ...resolvedData,
          id: targetShipmentId,
          createdAt: new Date(now).toISOString(),
        };
        nextList = [newShipment, ...prev];
      }

      return nextList
        .filter((s) => !fullyAbsorbedShipmentIds.has(s.id))
        .map((s) => {
          if (partiallyAbsorbedShippingRemaining.has(s.id)) {
            return {
              ...s,
              internalShipping:
                partiallyAbsorbedShippingRemaining.get(s.id) || 0,
            };
          }
          return s;
        });
    });

    // 4. Atualiza os CDs (remove descartados, aplica redistribuição/conversão de moeda, edita e adiciona novos)
    setCdItems((prev) => {
      const processedExisting = prev
        .filter((cd) => {
          // Exclui definitivamente os CDs descartados na consolidação
          if (discardedSet.has(cd.id)) {
            return false;
          }
          // Se estamos editando o pacote e o usuário removeu uma linha de CD que pertencia a este pacote
          if (
            existingId &&
            initialBundle?.enabled &&
            cd.shipmentId === existingId &&
            !absorbedSet.has(cd.id)
          ) {
            return updatedEntriesById.has(cd.id);
          }
          return true;
        })
        .map((cd) => {
          const adj = survivorAdjustments.get(cd.id);
          const baseUnitVal =
            (Number(cd.unitOriginalValue) || 0) +
            (adj?.extraUnitValueInSourceCurr || 0);
          const baseUnitShip =
            getItemUnitInternalShipping(cd, prev) +
            (adj?.extraUnitShipInSourceCurr || 0);
          const updatedBundleQty =
            adj?.newBundleQuantity !== undefined
              ? adj.newBundleQuantity
              : cd.bundleTotalQuantity;

          if (absorbedSet.has(cd.id)) {
            const factor = adj?.conversionFactorToTarget ?? 1;
            return {
              ...cd,
              shipmentId: targetShipmentId,
              currency: resolvedData.currency,
              isConsolidated: true,
              packingHandling: packingHandlingVal || cd.packingHandling,
              unitOriginalValue: Number((baseUnitVal * factor).toFixed(4)),
              unitInternalShipping: Number((baseUnitShip * factor).toFixed(4)),
              bundleTotalValue:
                cd.bundleTotalValue !== undefined
                  ? Number((cd.bundleTotalValue * factor).toFixed(4))
                  : undefined,
              bundleInternalShipping:
                cd.bundleInternalShipping !== undefined
                  ? Number((cd.bundleInternalShipping * factor).toFixed(4))
                  : undefined,
              bundleTotalQuantity: updatedBundleQty,
            };
          }

          if (adj) {
            // CD permaneceu no pacote de origem, mas recebeu redistribuição de irmãos descartados
            return {
              ...cd,
              unitOriginalValue: Number(baseUnitVal.toFixed(4)),
              unitInternalShipping: Number(baseUnitShip.toFixed(4)),
              bundleTotalQuantity: updatedBundleQty,
            };
          }

          if (existingId && updatedEntriesById.has(cd.id)) {
            const edited = updatedEntriesById.get(cd.id)!;
            return {
              ...cd,
              currency: resolvedData.currency,
              isConsolidated: isTargetConsolidated,
              artist: edited.artist,
              albumTitle: edited.albumTitle,
              discCount: edited.discCount || cd.discCount || 1,
              unitOriginalValue:
                edited.unitPrice !== undefined
                  ? edited.unitPrice
                  : cd.unitOriginalValue,
              coverUrl: edited.coverUrl ?? cd.coverUrl,
              releaseYear: edited.releaseYear ?? cd.releaseYear,
              localTrackingCode:
                initialBundle?.localTrackingCode || cd.localTrackingCode,
            };
          }
          if (existingId && cd.shipmentId === existingId) {
            return {
              ...cd,
              isConsolidated: isTargetConsolidated,
            };
          }
          return cd;
        });

      return [...processedExisting, ...newlyCreatedCDs];
    });

    if (newlyCreatedCDs.length > 0) {
      autoPopulateCoversForItems(newlyCreatedCDs);
    }

    setSelectedShipmentId(targetShipmentId);
    setMobileActivePane('detail');

    if (discardedSet.size > 0 && absorbedSet.size > 0) {
      showToast(
        `Pacote consolidado (${absorbedSet.size} CDs incluídos e ${discardedSet.size} descartado(s) com custo redistribuído)!`
      );
    } else if (absorbedSet.size > 0 && newlyCreatedCDs.length > 0) {
      showToast(
        `Pacote salvo com ${absorbedSet.size} CD(s) do redirecionador + ${newlyCreatedCDs.length} CD(s) novo(s)!`
      );
    } else if (absorbedSet.size > 0) {
      showToast(
        `Pacote consolidado com ${absorbedSet.size} CD(s) (status alterado p/ Já Consolidado)!`
      );
    } else if (!existingId && newlyCreatedCDs.length > 0) {
      showToast(
        `Pacote criado com ${newlyCreatedCDs.length} ${
          newlyCreatedCDs.length === 1 ? 'CD lançado' : 'CDs lançados'
        }!`
      );
    } else {
      showToast(
        existingId ? 'Pacote e CDs atualizados!' : 'Novo pacote criado!'
      );
    }
  };

  const handleDuplicateShipment = (shipment: Shipment) => {
    const now = new Date();
    const todayIso = `${now.getFullYear()}-${String(
      now.getMonth() + 1
    ).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const newShipmentId = `ship-${Date.now()}`;
    const duplicatedShipment: Shipment = {
      ...shipment,
      id: newShipmentId,
      name: `${shipment.name} (Cópia)`,
      isCustomName: true,
      status: 'no_redirecionador',
      shippingDate: todayIso,
      internationalTrackingCode: '',
      createdAt: new Date().toISOString(),
    };

    const sourceCDs = cdItems.filter((cd) => cd.shipmentId === shipment.id);
    const clonedCDs: CDItem[] = sourceCDs.map((cd, idx) => ({
      ...cd,
      id: `cd-${Date.now()}-${idx}`,
      shipmentId: newShipmentId,
      bundleId: cd.bundleId ? `${cd.bundleId}-copy-${Date.now()}` : undefined,
      createdAt: new Date().toISOString(),
    }));

    setShipments((prev) => [duplicatedShipment, ...prev]);
    setCdItems((prev) => [...prev, ...clonedCDs]);
    setSelectedShipmentId(newShipmentId);
    setMobileActivePane('detail');
    showToast(`Pacote "${shipment.name}" duplicado com seus itens!`);
  };

  const handleDeleteShipment = (shipment: Shipment) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Excluir Pacote de Importação',
      description: `Tem certeza que deseja excluir o pacote "${shipment.name}" e todos os CDs vinculados a ele? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir Pacote',
      onConfirm: () => {
        setShipments((prev) => {
          const remaining = prev.filter((s) => s.id !== shipment.id);
          if (selectedShipmentId === shipment.id) {
            setSelectedShipmentId(remaining[0]?.id || '');
          }
          return remaining;
        });
        setCdItems((prev) =>
          prev.filter((cd) => cd.shipmentId !== shipment.id)
        );
        setMobileActivePane('list');
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        showToast('Pacote excluído.');
      },
    });
  };

  // Botão Mágico Regra 4: Estimar Impostos MG (0,9277)
  const handleApplyMgTaxEstimate = (summary: ShipmentCalculationSummary) => {
    const estimatedValue = Number(summary.estimatedTaxMgBrl.toFixed(2));
    setShipments((prev) =>
      prev.map((s) =>
        s.id === summary.shipment.id
          ? {
              ...s,
              customsTaxBrl: estimatedValue,
              isTaxEstimated: true,
            }
          : s
      )
    );
    showToast(
      `Estimativa MG (fator ${MG_TAX_FACTOR}) aplicada: ${formatBrl(
        estimatedValue
      )}`
    );
  };

  // Alterar status rápido direto no painel do pacote
  const handleQuickStatusChange = (
    shipmentId: string,
    newStatus: ShipmentStatus
  ) => {
    const isRevertingToSingle =
      newStatus === 'comprado' || newStatus === 'no_redirecionador';

    setShipments((prev) =>
      prev.map((s) =>
        s.id === shipmentId
          ? {
              ...s,
              status: newStatus,
              consolidationMode: isRevertingToSingle
                ? 'direct'
                : s.consolidationMode,
            }
          : s
      )
    );

    setCdItems((prev) =>
      prev.map((cd) =>
        cd.shipmentId === shipmentId
          ? {
              ...cd,
              isConsolidated: !isRevertingToSingle,
              packingHandling: isRevertingToSingle
                ? undefined
                : cd.packingHandling,
            }
          : cd
      )
    );

    if (isRevertingToSingle) {
      showToast(
        'Status alterado para pacote avulso! Seus CDs voltaram a ficar disponíveis para consolidação.'
      );
    } else if (newStatus === 'consolidado') {
      showToast(
        'Pacote marcado como Já Consolidado (não aparecerá novamente para consolidação).'
      );
    }
  };

  // Botão rápido no cabeçalho do pacote: reverter todo o pacote para "Comprado (Pacote Único)"
  const handleRevertPackageToSingle = (shipment: Shipment) => {
    handleQuickStatusChange(shipment.id, 'comprado');
  };

  // Botão rápido em um CD específico: desmembrar/voltar apenas este CD para "Comprado (Pacote Único)"
  const handleExtractCdToSinglePackage = (item: CDItem) => {
    if (!selectedSummary) return;
    const parentShipment = selectedSummary.shipment;

    if (selectedSummary.items.length <= 1) {
      handleRevertPackageToSingle(parentShipment);
      return;
    }

    const now = Date.now();
    const newSingleShipmentId = `ship-${now}`;
    const newSingleShipment: Shipment = {
      id: newSingleShipmentId,
      name: generatePackageName([item]),
      shippingDate: parentShipment.shippingDate || '',
      status: 'comprado',
      currency: item.currency || parentShipment.currency,
      exchangeRate: parentShipment.exchangeRate,
      exchangeRateSource: parentShipment.exchangeRateSource,
      consolidationMode: 'direct',
      internalShipping: Number(item.unitInternalShipping) || 0,
      forwarderFee: 0,
      internationalShipping: 0,
      customsTaxBrl: 0,
      isTaxEstimated: false,
      internationalTrackingCode: '',
      notes: `Desmembrado do pacote "${parentShipment.name}"`,
      createdAt: new Date(now).toISOString(),
    };

    setShipments((prev) => [newSingleShipment, ...prev]);
    setCdItems((prev) =>
      prev.map((cd) =>
        cd.id === item.id
          ? {
              ...cd,
              shipmentId: newSingleShipmentId,
              isConsolidated: false,
              packingHandling: undefined,
              isBundle: false,
              bundleId: undefined,
              bundleName: undefined,
              bundleTotalValue: undefined,
              bundleTotalQuantity: undefined,
            }
          : cd
      )
    );
    showToast(
      `CD "${item.artist} - ${item.albumTitle}" voltou para Comprado (Pacote Único) e já pode ser consolidado novamente!`
    );
  };

  // --- AÇÕES DE CD / BUNDLE ---
  const handleSaveCDItems = (
    itemsData: Omit<CDItem, 'id' | 'createdAt'>[],
    editingId?: string,
    syncBundleSiblings?: boolean
  ) => {
    if (editingId && itemsData.length === 1) {
      const updated = itemsData[0];
      setCdItems((prev) =>
        prev.map((item) => {
          if (item.id === editingId) {
            return { ...item, ...updated };
          }
          if (
            syncBundleSiblings &&
            updated.isBundle &&
            updated.bundleId &&
            item.shipmentId === updated.shipmentId &&
            item.bundleId === updated.bundleId
          ) {
            return {
              ...item,
              bundleName: updated.bundleName,
              bundleTotalValue: updated.bundleTotalValue,
              bundleTotalQuantity: updated.bundleTotalQuantity,
              bundleInternalShipping: updated.bundleInternalShipping,
              unitInternalShipping: updated.unitInternalShipping,
              localTrackingCode: updated.localTrackingCode,
              unitOriginalValue: updated.unitOriginalValue,
            };
          }
          return item;
        })
      );

      if (!updated.coverUrl && !updated.albumTitle.startsWith('CD #')) {
        fetchBestAlbumCover(updated.artist, updated.albumTitle).then((best) => {
          if (best) {
            setCdItems((prev) =>
              prev.map((cd) =>
                cd.id === editingId
                  ? {
                      ...cd,
                      coverUrl: best.coverUrl,
                      releaseYear: cd.releaseYear || best.releaseYear,
                    }
                  : cd
              )
            );
          }
        });
      }

      showToast('CD atualizado e custos recalculados!');
    } else {
      const now = Date.now();
      const createdList: CDItem[] = itemsData.map((data, idx) => ({
        ...data,
        id: `cd-${now}-${idx}`,
        createdAt: new Date(now + idx * 100).toISOString(),
      }));
      setCdItems((prev) => [...prev, ...createdList]);
      autoPopulateCoversForItems(createdList);
      showToast(
        createdList.length > 1
          ? `${createdList.length} CDs do Bundle adicionados ao pacote!`
          : 'CD adicionado ao pacote!'
      );
    }
  };

  const handleDeleteCD = (item: CDItem) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Remover CD do Pacote',
      description: `Deseja remover "${item.artist} - ${item.albumTitle}" deste pacote? O rateio dos demais CDs será recalculado automaticamente.`,
      confirmLabel: 'Remover CD',
      onConfirm: () => {
        setCdItems((prev) => prev.filter((cd) => cd.id !== item.id));
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        showToast('CD removido e rateio recalculado.');
      },
    });
  };

  // Exportar e Importar Backup JSON
  const handleExportBackup = () => {
    const payload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      shipments,
      cdItems,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cd-import-tracker-backup-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Backup JSON exportado!');
  };

  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(String(event.target?.result));
        if (Array.isArray(parsed.shipments) && Array.isArray(parsed.cdItems)) {
          setShipments(parsed.shipments);
          setCdItems(parsed.cdItems);
          setSelectedShipmentId(parsed.shipments[0]?.id || '');
          showToast('Backup importado com sucesso!');
        } else {
          showToast(
            'Formato de arquivo inválido: listas de pacotes ou CDs ausentes.'
          );
        }
      } catch {
        showToast('Erro ao ler o arquivo JSON de backup.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  if (!isAuthLoaded) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-slate-400">
          <Disc3 className="w-5 h-5 animate-spin text-indigo-400" />
          Verificando sessão...
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl bg-slate-900/90 border border-slate-800 p-6 sm:p-8 shadow-2xl space-y-6 text-center">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/25 mx-auto">
            <Disc3 className="w-8 h-8 text-white" />
          </div>

          <div className="space-y-2">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              CD Import Tracker
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
              Faça login com sua conta Google para acessar e gerenciar seus
              pacotes, lotes e rateios de importação de forma individual.
            </p>
          </div>

          <SignInButton mode="modal">
            <button className="w-full inline-flex items-center justify-center gap-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/30 transition cursor-pointer">
              <LogIn className="w-4 h-4" />
              Entrar na minha conta
            </button>
          </SignInButton>

          <p className="text-[11px] text-slate-500">
            Cada usuário possui sua própria coleção e histórico de pacotes
            isolados.
          </p>
        </div>
      </div>
    );
  }

  if (!isHydrated) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-slate-400">
          <Disc3 className="w-5 h-5 animate-spin text-indigo-400" />
          Carregando suas importações...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Notificação Toast */}
      {toastMessage && (
        <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-5 sm:bottom-5 z-50 flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white shadow-xl shadow-indigo-950/60 border border-indigo-400/30">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* TOP BAR / HEADER */}
      <header className="border-b border-slate-800/80 bg-slate-900/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto px-3.5 sm:px-6 py-3 flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-3">
            {/* Brand */}
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 shrink-0">
                <Disc3 className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-base sm:text-lg font-bold tracking-tight text-white truncate">
                    CD Import Tracker
                  </h1>
                  <span className="hidden sm:inline-flex rounded-full bg-indigo-500/15 border border-indigo-500/30 px-2 py-0.5 text-[11px] font-medium text-indigo-300">
                    SPA Dashboard
                  </span>
                </div>
                <p className="text-[11px] sm:text-xs text-slate-400 truncate">
                  Compras no eBay, redirecionadores e rateio alfandegário em BRL
                </p>
              </div>
            </div>

            {/* Global KPIs (Desktop) + Cloud Sync Status + Backup Actions */}
            <div className="flex items-center gap-2.5 shrink-0">
              <div className="hidden lg:flex items-center gap-5 rounded-xl bg-slate-950/90 border border-slate-800 px-4 py-2 text-xs">
                <div>
                  <span className="text-slate-400 block">Total Investido</span>
                  <span className="font-mono font-bold text-white text-sm">
                    {formatBrl(globalStats.totalInvestedBrl)}
                  </span>
                </div>
                <div className="h-6 w-px bg-slate-800" />
                <div>
                  <span className="text-slate-400 block">
                    Álbuns / Box Sets
                  </span>
                  <span className="font-mono font-bold text-indigo-300 text-sm">
                    {globalStats.totalItems}{' '}
                    <span className="text-[11px] font-normal text-slate-400">
                      ({globalStats.totalPhysicalDiscs} discos)
                    </span>
                  </span>
                </div>
                <div className="h-6 w-px bg-slate-800" />
                <div>
                  <span className="text-slate-400 block">Média Real / CD</span>
                  <span className="font-mono font-bold text-emerald-400 text-sm">
                    {formatBrl(globalStats.avgPerItemBrl)}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 sm:gap-2">
                {/* Indicador Visual de Status do Cloud Sync */}
                {cloudSyncStatus === 'saving' && (
                  <span
                    title="Sincronizando alterações com a nuvem..."
                    className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 px-2.5 py-2 text-[11px] font-medium text-amber-300"
                  >
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                    <span className="hidden md:inline">Salvando...</span>
                  </span>
                )}
                {cloudSyncStatus === 'synced' && (
                  <span
                    title="Todos os dados estão salvos e sincronizados na nuvem"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-2 text-[11px] font-medium text-emerald-300"
                  >
                    <Cloud className="w-3.5 h-3.5 shrink-0" />
                    <span className="hidden md:inline">Sincronizado</span>
                  </span>
                )}
                {cloudSyncStatus === 'error' && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!currentUserId) return;
                      performServerSync(
                        shipments,
                        cdItems,
                        `${STORAGE_KEY_UPDATED_AT}_${currentUserId}`
                      );
                    }}
                    title="Falha ao sincronizar com a nuvem. Clique para tentar novamente."
                    className="inline-flex items-center gap-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 px-2.5 py-2 text-[11px] font-medium text-rose-300 transition"
                  >
                    <CloudOff className="w-3.5 h-3.5 shrink-0" />
                    <span className="hidden md:inline">Reenviar Sync</span>
                  </button>
                )}

                <button
                  onClick={handleExportBackup}
                  title="Exportar seus dados em arquivo JSON"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 px-2.5 sm:px-3 py-2 text-xs font-medium text-slate-200 transition"
                >
                  <Download className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="hidden sm:inline">Exportar Backup</span>
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  title="Importar backup JSON salvo anteriormente"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 px-2.5 sm:px-3 py-2 text-xs font-medium text-slate-200 transition"
                >
                  <Upload className="w-3.5 h-3.5 text-purple-400" />
                  <span className="hidden sm:inline">Importar</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json"
                  onChange={handleImportBackup}
                  className="hidden"
                />

                <div className="flex items-center gap-2 pl-1.5 sm:pl-2 border-l border-slate-800">
                  <span className="hidden xl:inline text-xs text-slate-400 max-w-[140px] truncate">
                    {user?.firstName ||
                      user?.primaryEmailAddress?.emailAddress}
                  </span>
                  <UserButton />
                </div>
              </div>
            </div>
          </div>

          {/* KPI Strip Compacta para Mobile/Tablet (< lg) */}
          <div className="grid grid-cols-3 gap-2 lg:hidden rounded-xl bg-slate-950/90 border border-slate-800/90 px-3 py-2 text-[11px]">
            <div>
              <span className="text-slate-400 block truncate">
                Total Investido
              </span>
              <span className="font-mono font-bold text-white text-xs sm:text-sm">
                {formatBrl(globalStats.totalInvestedBrl)}
              </span>
            </div>
            <div className="border-x border-slate-800 px-2">
              <span className="text-slate-400 block truncate">
                Álbuns (Discos)
              </span>
              <span className="font-mono font-bold text-indigo-300 text-xs sm:text-sm">
                {globalStats.totalItems}{' '}
                <span className="text-[10px] font-normal text-slate-400">
                  ({globalStats.totalPhysicalDiscs})
                </span>
              </span>
            </div>
            <div className="pl-1">
              <span className="text-slate-400 block truncate">
                Média Real / CD
              </span>
              <span className="font-mono font-bold text-emerald-400 text-xs sm:text-sm">
                {formatBrl(globalStats.avgPerItemBrl)}
              </span>
            </div>
          </div>

          {/* ABAS DE NAVEGAÇÃO PRINCIPAL: VISÃO POR PACOTES vs TODOS OS CDs DA COLEÇÃO */}
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800/60">
            <div className="inline-flex items-center gap-1.5 p-1 rounded-xl bg-slate-950/90 border border-slate-800">
              <button
                type="button"
                onClick={() => setActiveMainTab('packages')}
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  activeMainTab === 'packages'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Package className="w-3.5 h-3.5" />
                <span>Visão por Pacotes ({shipments.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveMainTab('collection')}
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  activeMainTab === 'collection'
                    ? 'bg-purple-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Disc3 className="w-3.5 h-3.5" />
                <span>Todos os CDs da Coleção ({globalStats.totalItems})</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* =====================================================================
          ABA 2: VISÃO GLOBAL "TODOS OS CDs DA COLEÇÃO"
          ===================================================================== */}
      {activeMainTab === 'collection' ? (
        <main className="flex-1 max-w-[1600px] w-full mx-auto px-3.5 sm:px-6 py-4 sm:py-6 space-y-4">
          <div className="rounded-2xl bg-slate-900/60 border border-slate-800/90 p-4 sm:p-5 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                  <Disc3 className="w-5 h-5 text-purple-400" />
                  Minha Coleção Completa ({allCollectionEntries.length} de{' '}
                  {globalStats.totalItems} CDs)
                </h2>
                <p className="text-xs text-slate-400">
                  Consulte e compare todos os CDs importados entre todos os
                  seus pacotes.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 sm:w-64">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Filtrar por artista, álbum ou pacote..."
                    value={collectionSearch}
                    onChange={(e) => setCollectionSearch(e.target.value)}
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:border-purple-500 focus:outline-none"
                  />
                </div>

                <select
                  value={collectionStatusFilter}
                  onChange={(e) =>
                    setCollectionStatusFilter(
                      e.target.value as ShipmentStatus | 'ALL'
                    )
                  }
                  className="rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-slate-200 focus:border-purple-500 focus:outline-none"
                >
                  <option value="ALL">Todos os Status</option>
                  {(Object.keys(STATUS_LABELS) as ShipmentStatus[]).map(
                    (st) => (
                      <option key={st} value={st}>
                        {STATUS_LABELS[st].label}
                      </option>
                    )
                  )}
                </select>

                <div className="flex items-center gap-1.5 rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-slate-300">
                  <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <select
                    value={collectionSortBy}
                    onChange={(e) =>
                      setCollectionSortBy(
                        e.target.value as
                          | 'artist'
                          | 'album'
                          | 'cost_asc'
                          | 'cost_desc'
                          | 'recent'
                      )
                    }
                    className="bg-transparent text-xs text-slate-200 focus:outline-none"
                  >
                    <option value="artist" className="bg-slate-900">
                      Artista (A-Z)
                    </option>
                    <option value="album" className="bg-slate-900">
                      Álbum (A-Z)
                    </option>
                    <option value="cost_asc" className="bg-slate-900">
                      Menor Custo Final (BRL)
                    </option>
                    <option value="cost_desc" className="bg-slate-900">
                      Maior Custo Final (BRL)
                    </option>
                    <option value="recent" className="bg-slate-900">
                      Mais Recentes
                    </option>
                  </select>
                </div>
              </div>
            </div>

            {allCollectionEntries.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 p-10 text-center space-y-2">
                <Disc3 className="w-10 h-10 text-slate-600 mx-auto" />
                <p className="text-sm font-medium text-slate-300">
                  Nenhum CD encontrado para este filtro
                </p>
              </div>
            ) : (
              <>
                {/* Mobile Cards da Coleção Global */}
                <div className="space-y-2.5 md:hidden">
                  {allCollectionEntries.map(({ item, shipment }) => {
                    const statusInfo = STATUS_LABELS[shipment.status];
                    return (
                      <div
                        key={item.id}
                        className="rounded-xl bg-slate-950/75 border border-slate-800/90 p-3 space-y-2"
                      >
                        <div className="flex items-start gap-3">
                          <div className="h-14 w-14 rounded-xl bg-slate-900 border border-slate-700/80 flex items-center justify-center overflow-hidden shrink-0">
                            {item.coverUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={item.coverUrl}
                                alt={item.albumTitle}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <Disc3 className="w-6 h-6 text-slate-600" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <span className="font-semibold text-sm text-white truncate">
                                {item.artist}
                              </span>
                              <span className="font-mono font-bold text-sm text-emerald-400 shrink-0">
                                {formatBrl(item.finalCostBrl)}
                              </span>
                            </div>
                            <p className="text-xs text-slate-300 truncate">
                              {item.albumTitle}
                            </p>
                            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedShipmentId(shipment.id);
                                  setActiveMainTab('packages');
                                  setMobileActivePane('detail');
                                }}
                                className="inline-flex items-center gap-1 rounded bg-slate-800 hover:bg-slate-700 px-1.5 py-0.5 text-[10px] text-indigo-300 truncate max-w-[180px]"
                              >
                                <Package className="w-2.5 h-2.5 shrink-0" />
                                <span className="truncate">
                                  {shipment.name}
                                </span>
                              </button>
                              <span
                                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${statusInfo.badgeClass}`}
                              >
                                {statusInfo.shortLabel}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Tabela Desktop da Coleção Global */}
                <div className="hidden md:block rounded-xl border border-slate-800 overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-950/90 text-[11px] font-semibold uppercase tracking-wider text-slate-400 whitespace-nowrap">
                        <th className="py-3 px-4">Capa, Artista & Álbum</th>
                        <th className="py-3 px-3">Pacote & Status</th>
                        <th className="py-3 px-3 text-right">Valor do CD</th>
                        <th className="py-3 px-3 text-right">+ Rateio Unit.</th>
                        <th className="py-3 px-4 text-right">
                          Custo Final (BRL)
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70 text-sm">
                      {allCollectionEntries.map(({ item, shipment }) => {
                        const statusInfo = STATUS_LABELS[shipment.status];
                        return (
                          <tr
                            key={item.id}
                            className="bg-slate-950/40 hover:bg-slate-900/80 transition"
                          >
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-3">
                                <div className="h-11 w-11 rounded-lg bg-slate-900 border border-slate-700/80 flex items-center justify-center overflow-hidden shrink-0">
                                  {item.coverUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={item.coverUrl}
                                      alt={item.albumTitle}
                                      className="h-full w-full object-cover"
                                    />
                                  ) : (
                                    <Disc3 className="w-5 h-5 text-slate-600" />
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-semibold text-white">
                                      {item.artist}
                                    </span>
                                    {item.releaseYear && (
                                      <span className="text-[10px] font-mono text-slate-400">
                                        ({item.releaseYear})
                                      </span>
                                    )}
                                    {item.discCount > 1 && (
                                      <span className="rounded bg-indigo-500/20 border border-indigo-500/30 px-1.5 py-0.5 text-[10px] font-mono text-indigo-300">
                                        Box {item.discCount} CDs
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-xs text-slate-300">
                                    {item.albumTitle}
                                  </div>
                                </div>
                              </div>
                            </td>

                            <td className="py-3 px-3">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedShipmentId(shipment.id);
                                    setActiveMainTab('packages');
                                  }}
                                  title="Abrir detalhes deste pacote"
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 px-2.5 py-1 text-xs font-medium text-indigo-300 transition max-w-[260px] truncate"
                                >
                                  <Package className="w-3.5 h-3.5 shrink-0" />
                                  <span className="truncate">
                                    {shipment.name}
                                  </span>
                                </button>
                                <span
                                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusInfo.badgeClass}`}
                                >
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full ${statusInfo.dotClass}`}
                                  />
                                  {statusInfo.shortLabel}
                                </span>
                                {shipment.weightKg && shipment.weightKg > 0 && (
                                  <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 text-[10px] font-mono text-emerald-300">
                                    <Scale className="w-2.5 h-2.5" />
                                    {formatWeightKg(shipment.weightKg)}
                                  </span>
                                )}
                              </div>
                            </td>

                            <td className="py-3 px-3 text-right font-mono whitespace-nowrap">
                              <div className="text-xs font-medium text-slate-200">
                                {formatOriginalCurrency(
                                  item.unitOriginalValue,
                                  shipment.currency
                                )}
                              </div>
                              <div className="text-[11px] text-slate-400">
                                {formatBrl(item.directCostBrl)}
                              </div>
                            </td>

                            <td className="py-3 px-3 text-right font-mono text-xs text-indigo-300 whitespace-nowrap">
                              + {formatBrl(item.allocatedIndirectCostBrl)}
                            </td>

                            <td className="py-3 px-4 text-right whitespace-nowrap">
                              <div className="font-mono font-bold text-sm text-emerald-400">
                                {formatBrl(item.finalCostBrl)}
                              </div>
                              {item.discCount > 1 && (
                                <div className="text-[10px] font-mono text-slate-400">
                                  ({formatBrl(item.costPerDiscBrl)} / disco)
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </main>
      ) : (
        /* =====================================================================
           ABA 1: MAIN SPA MASTER / DETAIL WORKSPACE (VISÃO POR PACOTES)
           ===================================================================== */
        <main className="flex-1 max-w-[1600px] w-full mx-auto px-3.5 sm:px-6 py-4 sm:py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* COLUNA ESQUERDA (MASTER): LISTA ENXUTA DE PACOTES */}
          <section
            className={`${
              mobileActivePane === 'detail' ? 'hidden lg:flex' : 'flex'
            } lg:col-span-4 xl:col-span-4 flex-col gap-3.5 bg-slate-900/60 border border-slate-800/90 rounded-2xl p-4 lg:sticky lg:top-24`}
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200 flex items-center gap-2">
                  <Package className="w-4 h-4 text-indigo-400" />
                  Pacotes / Lotes ({filteredShipments.length})
                </h2>
                <p className="text-[11px] text-slate-400">
                  Toque em um pacote para abrir seus detalhes
                </p>
              </div>

              <button
                onClick={() => {
                  setEditingShipment(null);
                  setIsShipmentModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-3.5 py-2 text-xs font-semibold text-white shadow-lg shadow-indigo-600/25 transition shrink-0"
              >
                <Plus className="w-4 h-4" />
                Novo Pacote
              </button>
            </div>

            {/* Barra de Busca Global e Filtro por Status */}
            <div className="space-y-2.5">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Buscar pacote, artista, álbum ou rastreio..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 pl-9 pr-3 py-2 text-sm sm:text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                <button
                  onClick={() => setStatusFilter('ALL')}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition shrink-0 ${
                    statusFilter === 'ALL'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  Todos ({shipments.length})
                </button>
                {(Object.keys(STATUS_LABELS) as ShipmentStatus[]).map((st) => (
                  <button
                    key={st}
                    onClick={() => setStatusFilter(st)}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition shrink-0 flex items-center gap-1.5 ${
                      statusFilter === st
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${STATUS_LABELS[st].dotClass}`}
                    />
                    {STATUS_LABELS[st].shortLabel}
                  </button>
                ))}
              </div>
            </div>

            {/* Lista Enxuta de Pacotes (Foco em Nome, Status, Qtd de CDs, Peso e Custo Total BRL) */}
            <div className="space-y-2 lg:max-h-[calc(100vh-270px)] overflow-y-auto pr-0.5">
              {filteredShipments.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center space-y-2">
                  <Package className="w-8 h-8 text-slate-600 mx-auto" />
                  <p className="text-xs text-slate-400">
                    Nenhum pacote encontrado para este filtro.
                  </p>
                </div>
              ) : (
                filteredShipments.map((ship) => {
                  const summary = summariesMap.get(ship.id);
                  const isSelected = ship.id === selectedShipmentId;
                  const statusInfo = STATUS_LABELS[ship.status];

                  return (
                    <div
                      key={ship.id}
                      onClick={() => {
                        setSelectedShipmentId(ship.id);
                        setIsEditingPackageTitle(false);
                        setMobileActivePane('detail');
                        if (
                          typeof window !== 'undefined' &&
                          window.innerWidth < 1024
                        ) {
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }
                      }}
                      className={`group cursor-pointer rounded-xl border p-3.5 transition-all ${
                        isSelected
                          ? 'bg-indigo-950/45 border-indigo-500/80 shadow-md shadow-indigo-950/40'
                          : 'bg-slate-950/70 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900/60'
                      }`}
                    >
                      {/* Linha 1: Nome + Status Badge */}
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-white truncate flex items-center gap-1.5">
                          {ship.isCustomName && (
                            <span
                              title="Nome personalizado travado"
                              className="inline-flex shrink-0"
                            >
                              <Lock className="w-3 h-3 text-amber-400" />
                            </span>
                          )}
                          <span className="truncate">{ship.name}</span>
                        </h3>

                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-medium shrink-0 ${statusInfo.badgeClass}`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${statusInfo.dotClass}`}
                          />
                          {statusInfo.shortLabel}
                        </span>
                      </div>

                      {/* Linha 2: Qtd de CDs + Peso (kg) + Modo + Custo Total BRL */}
                      <div className="mt-2.5 pt-2 border-t border-slate-800/70 flex items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-300">
                          <span className="inline-flex items-center gap-1.5">
                            <Disc3 className="w-3.5 h-3.5 text-purple-400" />
                            <strong>{summary?.totalItemsCount || 0}</strong>{' '}
                            {(summary?.totalItemsCount || 0) === 1
                              ? 'CD'
                              : 'CDs'}
                          </span>

                          {ship.weightKg && ship.weightKg > 0 && (
                            <span
                              className="inline-flex items-center gap-1 rounded bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 text-[10px] font-mono text-emerald-300"
                              title="Peso registrado do pacote"
                            >
                              <Scale className="w-2.5 h-2.5" />
                              {formatWeightKg(ship.weightKg)}
                            </span>
                          )}

                          {ship.consolidationMode === 'unpack_and_repack' && (
                            <span className="rounded bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 text-[10px] text-amber-300">
                              Desempacotado
                            </span>
                          )}
                          {ship.consolidationMode === 'group_only' && (
                            <span className="rounded bg-indigo-500/15 border border-indigo-500/30 px-1.5 py-0.5 text-[10px] text-indigo-300">
                              Agrupado
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-sm font-bold font-mono text-emerald-400">
                            {formatBrl(summary?.totalShipmentCostBrl || 0)}
                          </span>
                          <ChevronRight className="w-4 h-4 text-slate-500 lg:hidden" />
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* COLUNA DIREITA (DETAIL): DETALHES DO PACOTE SELECIONADO E LISTA DE CDs */}
          <section
            className={`${
              mobileActivePane === 'list' ? 'hidden lg:block' : 'block'
            } lg:col-span-8 xl:col-span-8 space-y-5`}
          >
            {/* Barra de Navegação Mobile Nativa (← Voltar para a Lista de Pacotes) */}
            <div className="flex items-center justify-between gap-2 lg:hidden">
              <button
                type="button"
                onClick={() => setMobileActivePane('list')}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 border border-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:text-white active:scale-95 transition"
              >
                <ArrowLeft className="w-4 h-4 text-indigo-400" />
                Voltar para Pacotes ({filteredShipments.length})
              </button>

              <button
                type="button"
                onClick={() => {
                  setEditingShipment(null);
                  setIsShipmentModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white"
              >
                <Plus className="w-3.5 h-3.5" />
                Novo Pacote
              </button>
            </div>

            {!selectedSummary ? (
              <div className="rounded-2xl bg-slate-900/50 border border-slate-800 p-10 text-center space-y-4">
                <Package className="w-12 h-12 text-slate-600 mx-auto" />
                <div>
                  <h3 className="text-base font-semibold text-white">
                    Nenhum Pacote Selecionado
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Selecione um pacote na lista ou crie um novo pacote para
                    começar a lançar seus CDs.
                  </p>
                </div>
                <button
                  onClick={() => {
                    setEditingShipment(null);
                    setIsShipmentModalOpen(true);
                  }}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2.5 text-xs font-semibold text-white"
                >
                  <Plus className="w-4 h-4" /> Criar Primeiro Pacote
                </button>
              </div>
            ) : (
              <>
                {/* CARD DE CABEÇALHO E CUSTOS DO PACOTE SELECIONADO */}
                <div className="rounded-2xl bg-slate-900/60 border border-slate-800/90 p-4 sm:p-5 space-y-4">
                  {/* Linha Superior: Nome (com edição inline e trava), Status, Rastreio, Peso e Botões de Ação */}
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4 border-b border-slate-800">
                    <div className="space-y-2 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {isEditingPackageTitle ? (
                          <div className="flex items-center gap-1.5 flex-1 min-w-[220px] max-w-md">
                            <input
                              type="text"
                              autoFocus
                              value={packageTitleDraft}
                              onChange={(e) =>
                                setPackageTitleDraft(e.target.value)
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleSavePackageTitleInline(
                                    selectedSummary.shipment
                                  );
                                } else if (e.key === 'Escape') {
                                  setIsEditingPackageTitle(false);
                                }
                              }}
                              className="flex-1 rounded-lg bg-slate-950 border border-indigo-500 px-2.5 py-1 text-sm font-bold text-white focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                handleSavePackageTitleInline(
                                  selectedSummary.shipment
                                )
                              }
                              className="p-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500"
                              title="Salvar nome personalizado"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setIsEditingPackageTitle(false)}
                              className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white"
                              title="Cancelar"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 min-w-0">
                            <h2
                              onClick={() => {
                                setPackageTitleDraft(
                                  selectedSummary.shipment.name
                                );
                                setIsEditingPackageTitle(true);
                              }}
                              title="Clique para personalizar o nome deste pacote"
                              className="text-lg sm:text-xl font-bold text-white cursor-pointer hover:text-indigo-300 transition truncate"
                            >
                              {selectedSummary.shipment.name}
                            </h2>
                            <button
                              type="button"
                              onClick={() =>
                                handleTogglePackageCustomNameLock(
                                  selectedSummary.shipment
                                )
                              }
                              title={
                                selectedSummary.shipment.isCustomName
                                  ? 'Nome personalizado travado. Clique para voltar ao nome automático gerado pelos CDs.'
                                  : 'Nome gerado automaticamente. Clique para travar o nome atual.'
                              }
                              className={`p-1 rounded-lg border text-xs transition ${
                                selectedSummary.shipment.isCustomName
                                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 hover:bg-amber-500/25'
                                  : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-white'
                              }`}
                            >
                              {selectedSummary.shipment.isCustomName ? (
                                <Lock className="w-3.5 h-3.5" />
                              ) : (
                                <Unlock className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        )}

                        <select
                          value={selectedSummary.shipment.status}
                          onChange={(e) =>
                            handleQuickStatusChange(
                              selectedSummary.shipment.id,
                              e.target.value as ShipmentStatus
                            )
                          }
                          className={`rounded-full border px-3 py-1 text-xs font-semibold cursor-pointer focus:outline-none ${
                            STATUS_LABELS[selectedSummary.shipment.status]
                              .badgeClass
                          }`}
                        >
                          <option
                            value="comprado"
                            className="bg-slate-900 text-white"
                          >
                            🛒 Comprado (Pacote Único)
                          </option>
                          <option
                            value="no_redirecionador"
                            className="bg-slate-900 text-white"
                          >
                            📍 No Redirecionador (Avulso)
                          </option>
                          <option
                            value="consolidado"
                            className="bg-slate-900 text-white"
                          >
                            📦 Já Consolidado (Redirecionador)
                          </option>
                          <option
                            value="em_transito"
                            className="bg-slate-900 text-white"
                          >
                            ✈️ Em Trânsito
                          </option>
                          <option
                            value="tributado"
                            className="bg-slate-900 text-white"
                          >
                            🧾 Tributado (Receita/MG)
                          </option>
                          <option
                            value="entregue"
                            className="bg-slate-900 text-white"
                          >
                            ✅ Entregue
                          </option>
                        </select>

                        {selectedSummary.shipment.consolidationMode ===
                          'unpack_and_repack' && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-500/30 px-2.5 py-0.5 text-[11px] font-medium text-amber-300">
                            <PackageOpen className="w-3 h-3" />
                            Desempacotado
                          </span>
                        )}
                        {selectedSummary.shipment.consolidationMode ===
                          'group_only' && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/15 border border-indigo-500/30 px-2.5 py-0.5 text-[11px] font-medium text-indigo-300">
                            <PackageCheck className="w-3 h-3" />
                            Agrupado
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-400">
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-slate-500" />
                          Compra:{' '}
                          <strong className="text-slate-200">
                            {selectedSummary.shipment.shippingDate
                              ? new Date(
                                  selectedSummary.shipment.shippingDate +
                                    'T12:00:00'
                                ).toLocaleDateString('pt-BR')
                              : selectedSummary.shipment.createdAt
                              ? new Date(
                                  selectedSummary.shipment.createdAt
                                ).toLocaleDateString('pt-BR')
                              : 'Não informada'}
                          </strong>
                        </span>

                        <span className="hidden sm:inline">•</span>

                        <span className="inline-flex items-center gap-1">
                          Câmbio:{' '}
                          <strong className="text-indigo-300 font-mono">
                            1 {selectedSummary.shipment.currency} ≈ R${' '}
                            {selectedSummary.shipment.exchangeRate.toFixed(2)}
                          </strong>
                        </span>

                        <span className="hidden sm:inline">•</span>

                        {isEditingPackageWeight ? (
                          <span className="inline-flex items-center gap-1">
                            <Scale className="w-3.5 h-3.5 text-emerald-400" />
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              autoFocus
                              placeholder="0.80"
                              value={packageWeightDraft}
                              onChange={(e) =>
                                setPackageWeightDraft(e.target.value)
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  const parsed = Math.max(
                                    0,
                                    parseFloat(packageWeightDraft) || 0
                                  );
                                  setShipments((prev) =>
                                    prev.map((s) =>
                                      s.id === selectedSummary.shipment.id
                                        ? {
                                            ...s,
                                            weightKg:
                                              parsed > 0
                                                ? Number(parsed.toFixed(3))
                                                : undefined,
                                          }
                                        : s
                                    )
                                  );
                                  setIsEditingPackageWeight(false);
                                  showToast(
                                    parsed > 0
                                      ? `Peso atualizado para ${formatWeightKg(
                                          parsed
                                        )}!`
                                      : 'Peso removido.'
                                  );
                                } else if (e.key === 'Escape') {
                                  setIsEditingPackageWeight(false);
                                }
                              }}
                              className="w-20 rounded bg-slate-950 border border-emerald-500 px-2 py-0.5 text-xs font-mono text-white focus:outline-none"
                            />
                            <span className="text-[11px] font-mono text-slate-400">
                              kg
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                const parsed = Math.max(
                                  0,
                                  parseFloat(packageWeightDraft) || 0
                                );
                                setShipments((prev) =>
                                  prev.map((s) =>
                                    s.id === selectedSummary.shipment.id
                                      ? {
                                          ...s,
                                          weightKg:
                                            parsed > 0
                                              ? Number(parsed.toFixed(3))
                                              : undefined,
                                        }
                                      : s
                                  )
                                );
                                setIsEditingPackageWeight(false);
                                showToast(
                                  parsed > 0
                                    ? `Peso atualizado para ${formatWeightKg(
                                        parsed
                                      )}!`
                                    : 'Peso removido.'
                                );
                              }}
                              className="p-1 rounded bg-emerald-600 text-white hover:bg-emerald-500"
                              title="Salvar peso"
                            >
                              <Check className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setIsEditingPackageWeight(false)}
                              className="p-1 rounded bg-slate-800 text-slate-300 hover:text-white"
                              title="Cancelar"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setPackageWeightDraft(
                                selectedSummary.weightKg
                                  ? String(selectedSummary.weightKg)
                                  : ''
                              );
                              setIsEditingPackageWeight(true);
                            }}
                            className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[11px] transition ${
                              selectedSummary.weightKg
                                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25'
                                : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-emerald-500/50 hover:text-emerald-300'
                            }`}
                            title={
                              selectedSummary.shippingCostPerKgOriginal
                                ? `Clique para editar o peso • Frete Internacional por kg: ${formatOriginalCurrency(
                                    selectedSummary.shippingCostPerKgOriginal,
                                    selectedSummary.shipment.currency
                                  )}/kg (${formatBrl(
                                    selectedSummary.shippingCostPerKgBrl || 0
                                  )}/kg)`
                                : 'Clique para definir ou alterar o peso deste pacote em kg'
                            }
                          >
                            <Scale className="w-3 h-3 text-emerald-400" />
                            {selectedSummary.weightKg ? (
                              <>
                                {formatWeightKg(selectedSummary.weightKg)}
                                {selectedSummary.gramsPerDisc
                                  ? ` (~${selectedSummary.gramsPerDisc}g/CD)`
                                  : ''}
                              </>
                            ) : (
                              <span>+ Definir Peso (kg)</span>
                            )}
                          </button>
                        )}

                        {selectedSummary.shipment.internationalTrackingCode && (
                          <a
                            href={`https://www.17track.net/pt/track#nums=${selectedSummary.shipment.internationalTrackingCode}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-md bg-sky-500/15 border border-sky-500/30 px-2 py-0.5 font-mono text-[11px] text-sky-300 hover:bg-sky-500/25 transition"
                            title="Rastrear pacote internacional no 17TRACK"
                          >
                            <Truck className="w-3 h-3" />
                            {selectedSummary.shipment.internationalTrackingCode}
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                      </div>

                      {selectedSummary.shipment.notes && (
                        <p className="text-xs text-slate-400 italic">
                          “{selectedSummary.shipment.notes}”
                        </p>
                      )}
                    </div>

                    {/* Ações do Pacote */}
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {(selectedSummary.shipment.status !== 'comprado' ||
                        selectedSummary.shipment.consolidationMode ===
                          'group_only' ||
                        selectedSummary.shipment.consolidationMode ===
                          'unpack_and_repack' ||
                        selectedSummary.items.some(
                          (cd) => cd.isConsolidated
                        )) && (
                        <button
                          type="button"
                          onClick={() =>
                            handleRevertPackageToSingle(
                              selectedSummary.shipment
                            )
                          }
                          title="Desfaz o status de consolidado deste pacote para que seus CDs fiquem disponíveis novamente para consolidação"
                          className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-700 border border-slate-600/80 px-3 py-2 text-xs font-medium text-slate-200 transition"
                        >
                          <RotateCcw className="w-3.5 h-3.5 text-sky-400" />
                          <span>Voltar p/ Pacote Único</span>
                        </button>
                      )}

                      <button
                        onClick={() =>
                          handleApplyMgTaxEstimate(selectedSummary)
                        }
                        title={`Calcula (Soma dos CDs) * Câmbio * ${MG_TAX_FACTOR} (apenas sobre o valor dos produtos)`}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 px-3 py-2 text-xs font-semibold text-amber-300 transition"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                        <span>
                          Estimar MG (
                          {formatBrl(selectedSummary.estimatedTaxMgBrl)})
                        </span>
                      </button>

                      <button
                        onClick={() => {
                          setEditingShipment(selectedSummary.shipment);
                          setIsShipmentModalOpen(true);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-2 text-xs font-medium text-slate-200 transition"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Editar Pacote</span>
                      </button>

                      <button
                        onClick={() =>
                          handleDuplicateShipment(selectedSummary.shipment)
                        }
                        title="Criar uma cópia deste pacote com todas as taxas e CDs"
                        className="inline-flex items-center justify-center rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 p-2 text-slate-300 hover:text-white transition"
                      >
                        <Copy className="w-4 h-4 text-sky-400" />
                      </button>

                      <button
                        onClick={() =>
                          handleDeleteShipment(selectedSummary.shipment)
                        }
                        title="Excluir pacote"
                        className="inline-flex items-center justify-center rounded-xl bg-rose-950/40 hover:bg-rose-900/50 border border-rose-800/50 p-2 text-rose-300 transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* PAINEL DE 4 CARDS COM DETALHAMENTO INTEGRADO */}
                  <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                    {/* Card 1: Custo dos CDs (Direto) */}
                    <div className="rounded-xl bg-slate-950/80 border border-slate-800/90 p-3.5 flex flex-col justify-between space-y-1.5">
                      <div>
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span>1. Soma dos CDs</span>
                          <Disc3 className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                        </div>
                        <div className="text-base sm:text-lg font-bold font-mono text-white mt-0.5">
                          {formatBrl(selectedSummary.totalItemsBrl)}
                        </div>
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        {formatOriginalCurrency(
                          selectedSummary.totalItemsOriginal,
                          selectedSummary.shipment.currency
                        )}{' '}
                        • {selectedSummary.totalItemsCount} CDs (
                        {selectedSummary.totalPhysicalDiscsCount} discos)
                      </div>
                    </div>

                    {/* Card 2: Custo Indireto Total */}
                    <div className="rounded-xl bg-slate-950/80 border border-slate-800/90 p-3.5 flex flex-col justify-between space-y-1.5">
                      <div>
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span>2. Custos Indiretos</span>
                          <Receipt className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                        </div>
                        <div className="text-base sm:text-lg font-bold font-mono text-sky-300 mt-0.5">
                          {formatBrl(selectedSummary.totalIndirectCostBrl)}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] font-mono text-slate-400">
                        <span title="Frete Local + Redirecionador + Frete Internacional">
                          Fretes:{' '}
                          <strong className="text-slate-300">
                            {formatOriginalCurrency(
                              selectedSummary.totalInternalShippingOriginal +
                                selectedSummary.shipment.forwarderFee +
                                selectedSummary.shipment.internationalShipping,
                              selectedSummary.shipment.currency
                            )}
                          </strong>
                        </span>
                        <span>•</span>
                        <span title="Taxa de Importação / Alfândega no Brasil">
                          Taxa BR:{' '}
                          <strong className="text-amber-300">
                            {formatBrl(selectedSummary.shipment.customsTaxBrl)}
                          </strong>
                          {selectedSummary.shipment.isTaxEstimated && ' (Est.)'}
                        </span>
                      </div>
                    </div>

                    {/* Card 3: Rateio Unitário por CD */}
                    <div className="rounded-xl bg-indigo-950/30 border border-indigo-500/30 p-3.5 flex flex-col justify-between space-y-1.5">
                      <div>
                        <div className="flex items-center justify-between text-[11px] text-indigo-300">
                          <span>3. Rateio / CD</span>
                          <Info className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                        </div>
                        <div className="text-base sm:text-lg font-bold font-mono text-indigo-300 mt-0.5">
                          + {formatBrl(selectedSummary.allocatedCostPerItemBrl)}
                        </div>
                      </div>
                      <div className="text-[11px] text-indigo-200/70 truncate">
                        {selectedSummary.totalItemsCount > 0
                          ? `${formatBrl(
                              selectedSummary.totalIndirectCostBrl
                            )} ÷ ${selectedSummary.totalItemsCount} CDs`
                          : 'Sem CDs no pacote'}
                      </div>
                    </div>

                    {/* Card 4: Custo Final Consolidado da Caixa */}
                    <div className="rounded-xl bg-emerald-950/25 border border-emerald-500/30 p-3.5 flex flex-col justify-between space-y-1.5">
                      <div>
                        <div className="flex items-center justify-between text-[11px] text-emerald-300">
                          <span>4. Total do Pacote</span>
                          <Box className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        </div>
                        <div className="text-base sm:text-lg font-bold font-mono text-emerald-400 mt-0.5">
                          {formatBrl(selectedSummary.totalShipmentCostBrl)}
                        </div>
                      </div>
                      <div className="text-[11px] text-emerald-200/70">
                        Média:{' '}
                        <strong className="font-mono">
                          {selectedSummary.totalItemsCount > 0
                            ? formatBrl(
                                selectedSummary.totalShipmentCostBrl /
                                  selectedSummary.totalItemsCount
                              )
                            : 'R$ 0,00'}
                        </strong>
                        /CD
                      </div>
                    </div>
                  </div>
                </div>

                {/* LISTA DE CDs DO PACOTE SELECIONADO */}
                <div className="rounded-2xl bg-slate-900/60 border border-slate-800/90 p-4 sm:p-5 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-white flex items-center gap-2">
                        <Disc3 className="w-5 h-5 text-purple-400" />
                        CDs neste Pacote ({selectedSummary.items.length})
                      </h3>
                      <p className="text-xs text-slate-400">
                        Toque no título de qualquer álbum para renomear ou na
                        capa para escolher outra arte.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {selectedSummary.items.length > 0 && (
                        <button
                          onClick={handleFetchAllCoversInShipment}
                          disabled={isFetchingCoversBatch}
                          title="Busca automaticamente na internet a capa de todos os CDs sem capa"
                          className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 px-3 py-2 text-xs font-medium text-indigo-300 transition disabled:opacity-50"
                        >
                          {isFetchingCoversBatch ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <ImageIcon className="w-3.5 h-3.5" />
                          )}
                          <span className="hidden sm:inline">
                            Buscar Capas Automaticamente
                          </span>
                          <span className="sm:hidden">Capas</span>
                        </button>
                      )}

                      {/* Seletor de Ordenação */}
                      <div className="flex items-center gap-1.5 rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-slate-300">
                        <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <select
                          value={cdSortBy}
                          onChange={(e) =>
                            setCdSortBy(
                              e.target.value as
                                | 'created'
                                | 'artist'
                                | 'cost_desc'
                                | 'cost_asc'
                            )
                          }
                          className="bg-transparent text-xs text-slate-200 focus:outline-none"
                        >
                          <option value="created" className="bg-slate-900">
                            Ordem de Cadastro
                          </option>
                          <option value="artist" className="bg-slate-900">
                            Artista (A-Z)
                          </option>
                          <option value="cost_desc" className="bg-slate-900">
                            Maior Custo (BRL)
                          </option>
                          <option value="cost_asc" className="bg-slate-900">
                            Menor Custo (BRL)
                          </option>
                        </select>
                      </div>

                      <button
                        onClick={() => {
                          setEditingCD(null);
                          setIsCDModalOpen(true);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 px-3.5 py-2 text-xs font-semibold text-white shadow-lg shadow-purple-600/25 transition ml-auto sm:ml-0"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Adicionar CD / Bundle</span>
                      </button>
                    </div>
                  </div>

                  {displayedCDItems.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-800 p-8 sm:p-10 text-center space-y-3">
                      <Disc3 className="w-10 h-10 text-slate-600 mx-auto" />
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-slate-300">
                          Nenhum CD cadastrado neste pacote ainda
                        </p>
                        <p className="text-xs text-slate-500 max-w-md mx-auto">
                          Clique em &ldquo;Adicionar CD / Bundle&rdquo; ou em
                          &ldquo;Editar Pacote&rdquo; para lançar os discos e
                          calcular o rateio em tempo real.
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setEditingCD(null);
                          setIsCDModalOpen(true);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 px-4 py-2 text-xs font-semibold text-white transition"
                      >
                        <Plus className="w-4 h-4" />
                        Adicionar Primeiro CD
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* =========================================================
                          VISÃO MOBILE (< md): CARDS DE ÁLBUM SEM SCROLL HORIZONTAL
                          ========================================================= */}
                      <div className="space-y-2.5 md:hidden">
                        {displayedCDItems.map((item) => {
                          const isInlineEditing = inlineEditingId === item.id;
                          const canRevertCd =
                            selectedSummary.shipment.status !== 'comprado' ||
                            item.isConsolidated ||
                            selectedSummary.items.length > 1;

                          return (
                            <div
                              key={item.id}
                              className="rounded-xl bg-slate-950/75 border border-slate-800/90 p-3 space-y-2.5"
                            >
                              <div className="flex items-start gap-3">
                                {/* Capa */}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingCD(item);
                                    setIsCDModalOpen(true);
                                  }}
                                  className="relative h-14 w-14 rounded-xl bg-slate-900 border border-slate-700/80 flex items-center justify-center overflow-hidden shrink-0 shadow"
                                >
                                  {item.coverUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={item.coverUrl}
                                      alt={item.albumTitle}
                                      className="h-full w-full object-cover"
                                    />
                                  ) : (
                                    <Disc3 className="w-6 h-6 text-slate-600" />
                                  )}
                                </button>

                                {/* Artista, Álbum e Badges */}
                                <div className="flex-1 min-w-0">
                                  {isInlineEditing ? (
                                    <div className="space-y-1.5">
                                      <input
                                        type="text"
                                        value={inlineArtist}
                                        onChange={(e) =>
                                          setInlineArtist(e.target.value)
                                        }
                                        placeholder="Artista"
                                        className="w-full rounded-lg bg-slate-900 border border-indigo-500 px-2.5 py-1.5 text-sm text-white focus:outline-none"
                                      />
                                      <div className="flex items-center gap-1.5">
                                        <input
                                          type="text"
                                          autoFocus
                                          value={inlineAlbum}
                                          onChange={(e) =>
                                            setInlineAlbum(e.target.value)
                                          }
                                          placeholder="Nome do Álbum"
                                          className="flex-1 min-w-0 rounded-lg bg-slate-900 border border-indigo-500 px-2.5 py-1.5 text-sm text-white focus:outline-none"
                                        />
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleSaveInlineEdit(item)
                                          }
                                          className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white shrink-0"
                                        >
                                          Salvar
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <>
                                      <div className="flex items-start justify-between gap-2">
                                        <div className="font-semibold text-sm text-white truncate">
                                          {item.artist}{' '}
                                          {item.releaseYear && (
                                            <span className="text-[11px] font-mono text-slate-400 font-normal">
                                              ({item.releaseYear})
                                            </span>
                                          )}
                                        </div>

                                        {/* Custo Final em Destaque */}
                                        <span className="font-mono font-bold text-sm text-emerald-400 shrink-0">
                                          {formatBrl(item.finalCostBrl)}
                                        </span>
                                      </div>

                                      <div
                                        onClick={() => {
                                          setInlineEditingId(item.id);
                                          setInlineArtist(item.artist);
                                          setInlineAlbum(
                                            item.albumTitle.startsWith('CD #')
                                              ? ''
                                              : item.albumTitle
                                          );
                                        }}
                                        className="text-xs text-slate-300 mt-0.5 flex items-center gap-1.5 cursor-pointer"
                                      >
                                        <span className="truncate">
                                          {item.albumTitle}
                                        </span>
                                        <Edit3 className="w-3 h-3 text-indigo-400 shrink-0" />
                                      </div>

                                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                                        {item.isBundle ? (
                                          <span
                                            className="inline-flex items-center gap-1 rounded bg-purple-500/15 border border-purple-500/30 px-1.5 py-0.5 text-[10px] text-purple-300 whitespace-nowrap"
                                            title={item.bundleName || 'Lote'}
                                          >
                                            <Layers className="w-2.5 h-2.5 shrink-0" />
                                            {formatShortBundleBadge(
                                              item,
                                              selectedSummary.shipment.name
                                            )}
                                          </span>
                                        ) : (
                                          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400 whitespace-nowrap">
                                            Avulso
                                          </span>
                                        )}

                                        {item.packingHandling ===
                                          'unpacked' && (
                                          <span className="rounded bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 text-[10px] text-amber-300 whitespace-nowrap">
                                            Fora da caixa
                                          </span>
                                        )}
                                        {item.packingHandling ===
                                          'original_box' && (
                                          <span className="rounded bg-indigo-500/15 border border-indigo-500/30 px-1.5 py-0.5 text-[10px] text-indigo-300 whitespace-nowrap">
                                            Caixa original
                                          </span>
                                        )}
                                        {item.discCount > 1 && (
                                          <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-mono text-indigo-300 whitespace-nowrap">
                                            Box {item.discCount} CDs
                                          </span>
                                        )}
                                      </div>
                                    </>
                                  )}
                                </div>
                              </div>

                              {/* Rodapé do Card Mobile: Memória de Cálculo + Ações */}
                              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2 text-[11px]">
                                <div className="font-mono text-slate-400 truncate">
                                  <span className="text-slate-200">
                                    {formatOriginalCurrency(
                                      item.unitOriginalValue,
                                      selectedSummary.shipment.currency
                                    )}
                                  </span>{' '}
                                  ({formatBrl(item.directCostBrl)}){' '}
                                  <span className="text-indigo-300">
                                    + {formatBrl(item.allocatedIndirectCostBrl)}{' '}
                                    rateio
                                  </span>
                                </div>

                                <div className="flex items-center gap-1 shrink-0">
                                  {canRevertCd && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleExtractCdToSinglePackage(item)
                                      }
                                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium text-sky-300 hover:text-white bg-slate-900 border border-slate-800"
                                      title="Voltar este CD para Comprado (Pacote Único)"
                                    >
                                      <RotateCcw className="w-3 h-3" />
                                      <span>Pacote Único</span>
                                    </button>
                                  )}
                                  <button
                                    onClick={() => {
                                      setEditingCD(item);
                                      setIsCDModalOpen(true);
                                    }}
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-white bg-slate-900"
                                    title="Editar CD"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteCD(item)}
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 bg-slate-900"
                                    title="Excluir CD"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* =========================================================
                          VISÃO DESKTOP (md+): TABELA ENXUTA DE 5 COLUNAS SEM SCROLL HORIZONTAL
                          ========================================================= */}
                      <div className="hidden md:block rounded-xl border border-slate-800 overflow-hidden">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-slate-800 bg-slate-950/90 text-[11px] font-semibold uppercase tracking-wider text-slate-400 whitespace-nowrap">
                              <th className="py-3 px-4">
                                Capa, Artista & Álbum
                              </th>
                              <th className="py-3 px-3 text-right">
                                Valor do CD
                              </th>
                              <th className="py-3 px-3 text-right">
                                + Rateio Unit.
                              </th>
                              <th className="py-3 px-4 text-right">
                                Custo Final (BRL)
                              </th>
                              <th className="py-3 px-3 text-center">Ações</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/70 text-sm">
                            {displayedCDItems.map((item) => {
                              const isHighlightedBySearch =
                                searchQuery.trim().length > 0 &&
                                (item.artist
                                  .toLowerCase()
                                  .includes(searchQuery.toLowerCase()) ||
                                  item.albumTitle
                                    .toLowerCase()
                                    .includes(searchQuery.toLowerCase()));

                              const isInlineEditing =
                                inlineEditingId === item.id;
                              const canRevertCd =
                                selectedSummary.shipment.status !==
                                  'comprado' ||
                                item.isConsolidated ||
                                selectedSummary.items.length > 1;

                              return (
                                <tr
                                  key={item.id}
                                  className={`transition ${
                                    isHighlightedBySearch
                                      ? 'bg-indigo-950/40'
                                      : 'bg-slate-950/40 hover:bg-slate-900/80'
                                  }`}
                                >
                                  {/* Coluna 1: Capa + Artista, Álbum e Tags de Origem/Embalagem */}
                                  <td className="py-3 px-4 w-full max-w-0">
                                    <div className="flex items-center gap-3">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingCD(item);
                                          setIsCDModalOpen(true);
                                        }}
                                        title="Clique para trocar ou buscar a capa deste álbum"
                                        className="group relative h-12 w-12 rounded-lg bg-slate-900 border border-slate-700/80 flex items-center justify-center overflow-hidden shrink-0 shadow hover:border-indigo-400 transition"
                                      >
                                        {item.coverUrl ? (
                                          // eslint-disable-next-line @next/next/no-img-element
                                          <img
                                            src={item.coverUrl}
                                            alt={item.albumTitle}
                                            className="h-full w-full object-cover"
                                          />
                                        ) : (
                                          <Disc3 className="w-5 h-5 text-slate-600 group-hover:text-indigo-400 transition" />
                                        )}
                                      </button>

                                      <div className="min-w-0 flex-1">
                                        {isInlineEditing ? (
                                          <div className="space-y-1.5 max-w-xs">
                                            <input
                                              type="text"
                                              value={inlineArtist}
                                              onChange={(e) =>
                                                setInlineArtist(e.target.value)
                                              }
                                              placeholder="Artista (ex: HIM)"
                                              className="w-full rounded bg-slate-900 border border-indigo-500 px-2 py-1 text-xs text-white focus:outline-none"
                                            />
                                            <div className="flex items-center gap-1.5">
                                              <input
                                                type="text"
                                                autoFocus
                                                value={inlineAlbum}
                                                onChange={(e) =>
                                                  setInlineAlbum(e.target.value)
                                                }
                                                onKeyDown={(e) => {
                                                  if (e.key === 'Enter') {
                                                    handleSaveInlineEdit(item);
                                                  } else if (
                                                    e.key === 'Escape'
                                                  ) {
                                                    setInlineEditingId(null);
                                                  }
                                                }}
                                                placeholder="Nome do Álbum"
                                                className="flex-1 rounded bg-slate-900 border border-indigo-500 px-2 py-1 text-xs text-white focus:outline-none"
                                              />
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  handleSaveInlineEdit(item)
                                                }
                                                className="rounded bg-indigo-600 hover:bg-indigo-500 px-2.5 py-1 text-[11px] font-semibold text-white shrink-0 whitespace-nowrap"
                                              >
                                                Salvar + Capa
                                              </button>
                                            </div>
                                          </div>
                                        ) : (
                                          <div>
                                            <div className="flex flex-wrap items-center gap-1.5 leading-snug">
                                              <span className="font-semibold text-white truncate">
                                                {item.artist}
                                              </span>
                                              {item.releaseYear && (
                                                <span className="text-[10px] font-mono text-slate-400 font-normal whitespace-nowrap">
                                                  ({item.releaseYear})
                                                </span>
                                              )}

                                              {item.isBundle ? (
                                                <span
                                                  className="inline-flex items-center gap-1 rounded bg-purple-500/15 border border-purple-500/30 px-1.5 py-0.5 text-[10px] font-medium text-purple-300 whitespace-nowrap"
                                                  title={`Lote: ${formatOriginalCurrency(
                                                    item.bundleTotalValue || 0,
                                                    selectedSummary.shipment
                                                      .currency
                                                  )} ÷ ${
                                                    item.bundleTotalQuantity ||
                                                    1
                                                  }${
                                                    item.bundleName
                                                      ? ` — ${item.bundleName}`
                                                      : ''
                                                  }`}
                                                >
                                                  <Layers className="w-2.5 h-2.5 shrink-0" />
                                                  {formatShortBundleBadge(
                                                    item,
                                                    selectedSummary.shipment
                                                      .name
                                                  )}
                                                </span>
                                              ) : (
                                                <span className="inline-flex items-center rounded bg-slate-800/80 px-1.5 py-0.5 text-[10px] text-slate-400 whitespace-nowrap">
                                                  Avulso
                                                </span>
                                              )}

                                              {item.packingHandling ===
                                                'unpacked' && (
                                                <span className="inline-flex items-center rounded bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 text-[10px] text-amber-300 whitespace-nowrap">
                                                  Fora da caixa
                                                </span>
                                              )}
                                              {item.packingHandling ===
                                                'original_box' && (
                                                <span className="inline-flex items-center rounded bg-indigo-500/15 border border-indigo-500/30 px-1.5 py-0.5 text-[10px] text-indigo-300 whitespace-nowrap">
                                                  Caixa original
                                                </span>
                                              )}
                                              {item.discCount > 1 && (
                                                <span className="rounded bg-indigo-500/20 border border-indigo-500/30 px-1.5 py-0.5 text-[10px] font-mono text-indigo-300 whitespace-nowrap">
                                                  Box {item.discCount} CDs
                                                </span>
                                              )}
                                              {item.localTrackingCode && (
                                                <span className="font-mono text-[10px] text-sky-300 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800 whitespace-nowrap">
                                                  🚚 {item.localTrackingCode}
                                                </span>
                                              )}
                                            </div>

                                            <div
                                              onClick={() => {
                                                setInlineEditingId(item.id);
                                                setInlineArtist(item.artist);
                                                setInlineAlbum(
                                                  item.albumTitle.startsWith(
                                                    'CD #'
                                                  )
                                                    ? ''
                                                    : item.albumTitle
                                                );
                                              }}
                                              title="Clique para renomear o álbum e buscar a capa"
                                              className="text-xs text-slate-300 hover:text-indigo-300 cursor-pointer flex items-center gap-1.5 mt-0.5 group/title"
                                            >
                                              <span
                                                className={`truncate ${
                                                  item.albumTitle.startsWith(
                                                    'CD #'
                                                  )
                                                    ? 'underline decoration-dashed decoration-indigo-400/60 text-indigo-200'
                                                    : ''
                                                }`}
                                              >
                                                {item.albumTitle}
                                              </span>
                                              <Edit3 className="w-3 h-3 opacity-0 group-hover/title:opacity-100 text-indigo-400 transition shrink-0" />
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </td>

                                  {/* Coluna 2: Valor Original (em cima) + CD Convertido BRL (embaixo) */}
                                  <td className="py-3 px-3 text-right font-mono whitespace-nowrap">
                                    <div
                                      className="text-xs font-medium text-slate-200"
                                      title={
                                        item.isBundle && item.bundleTotalValue
                                          ? `${formatOriginalCurrency(
                                              item.bundleTotalValue,
                                              selectedSummary.shipment.currency
                                            )} ÷ ${item.bundleTotalQuantity}`
                                          : undefined
                                      }
                                    >
                                      {formatOriginalCurrency(
                                        item.unitOriginalValue,
                                        selectedSummary.shipment.currency
                                      )}
                                    </div>
                                    <div className="text-[11px] text-slate-400">
                                      {formatBrl(item.directCostBrl)}
                                    </div>
                                  </td>

                                  {/* Coluna 3: Rateio Unitário */}
                                  <td className="py-3 px-3 text-right font-mono text-xs text-indigo-300 whitespace-nowrap">
                                    + {formatBrl(item.allocatedIndirectCostBrl)}
                                  </td>

                                  {/* Coluna 4: Custo Final BRL */}
                                  <td className="py-3 px-4 text-right whitespace-nowrap">
                                    <div className="font-mono font-bold text-sm text-emerald-400">
                                      {formatBrl(item.finalCostBrl)}
                                    </div>
                                    {item.discCount > 1 && (
                                      <div className="text-[10px] font-mono text-slate-400 whitespace-nowrap">
                                        ({formatBrl(item.costPerDiscBrl)} /
                                        disco)
                                      </div>
                                    )}
                                  </td>

                                  {/* Coluna 5: Ações */}
                                  <td className="py-3 px-3 text-center whitespace-nowrap">
                                    <div className="inline-flex items-center gap-1 whitespace-nowrap">
                                      {canRevertCd && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleExtractCdToSinglePackage(item)
                                          }
                                          title="Desmembrar este CD em um Pacote Único separado"
                                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-sky-300 hover:text-white hover:bg-slate-800 border border-slate-800 transition whitespace-nowrap"
                                        >
                                          <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                                          <span className="hidden xl:inline">
                                            Pacote Único
                                          </span>
                                        </button>
                                      )}
                                      <button
                                        onClick={() => {
                                          setEditingCD(item);
                                          setIsCDModalOpen(true);
                                        }}
                                        title="Editar detalhes e escolher capa do álbum"
                                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                                      >
                                        <Edit3 className="w-4 h-4" />
                                      </button>
                                      <button
                                        onClick={() => handleDeleteCD(item)}
                                        title="Remover CD do pacote"
                                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </section>
        </main>
      )}

      {/* POP-UP 1: MODAL ÚNICO DE CRIAR / EDITAR PACOTE E SEUS CDs */}
      <ShipmentModal
        isOpen={isShipmentModalOpen}
        onClose={() => {
          setIsShipmentModalOpen(false);
          setEditingShipment(null);
        }}
        onSave={handleSaveShipment}
        editingShipment={editingShipment}
        editingShipmentItems={editingShipmentItems}
        forwarderPackages={forwarderPackages}
      />

      {/* POP-UP 2: MODAL DE CD / BUNDLE */}
      {selectedSummary && (
        <CDModal
          isOpen={isCDModalOpen}
          onClose={() => {
            setIsCDModalOpen(false);
            setEditingCD(null);
          }}
          shipmentId={selectedSummary.shipment.id}
          currency={selectedSummary.shipment.currency}
          exchangeRate={selectedSummary.shipment.exchangeRate}
          editingItem={editingCD}
          existingBundles={existingBundlesInSelected}
          onSaveItems={handleSaveCDItems}
        />
      )}

      {/* POP-UP 3: MODAL CUSTOMIZADO DE CONFIRMAÇÃO */}
      {confirmDialog.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700/80 p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-rose-500/20 text-rose-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-white">
                  {confirmDialog.title}
                </h3>
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                  {confirmDialog.description}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() =>
                  setConfirmDialog((prev) => ({ ...prev, isOpen: false }))
                }
                className="px-4 py-2 rounded-xl text-xs sm:text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmDialog.onConfirm}
                className="px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/25 transition"
              >
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
