'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SignInButton, useUser } from '@clerk/nextjs';
import {
  CDItem,
  CalculatedCDItem,
  Shipment,
  ShipmentCalculationSummary,
  ShipmentStatus,
} from '@/types/tracker';
import {
  MG_TAX_FACTOR,
  calculateAllShipmentSummaries,
  formatBrl,
  generatePackageName,
  getTodayLocalIsoDate,
} from '@/lib/calculations';
import {
  executeConsolidation,
  extractCdToSingleShipment,
} from '@/lib/domain/consolidation';
import { useTrackerData } from '@/hooks/useTrackerData';
import { TrackerHeader } from '@/components/tracker/TrackerHeader';
import { ConfirmDialogState, ConfirmModal } from '@/components/tracker/ConfirmModal';
import { GlobalCollectionView } from '@/components/tracker/GlobalCollectionView';
import { PackageSidebar } from '@/components/tracker/PackageSidebar';
import { PackageDetailView } from '@/components/tracker/PackageDetailView';
import { fetchBestAlbumCover, fetchCoversInBatch } from '@/lib/coverArt';
import {
  AbsorbedForwarderItemsPayload,
  ForwarderPackageOption,
  InitialBundlePayload,
  ShipmentModal,
} from '@/components/ShipmentModal';
import { CDModal } from '@/components/CDModal';
import { DemandRadarView } from '@/components/DemandRadarView';
import {
  Disc3,
  Package,
  CheckCircle2,
  LogIn,
  Flame,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';

export default function CDImportTrackerApp() {
  const { isLoaded: isAuthLoaded, isSignedIn, user } = useUser();
  const currentUserId = user?.id || null;

  const {
    shipments,
    setShipments,
    cdItems,
    setCdItems,
    selectedShipmentId,
    setSelectedShipmentId,
    isHydrated,
    cloudSyncStatus,
    forceSync,
  } = useTrackerData({
    isAuthLoaded,
    isSignedIn: Boolean(isSignedIn),
    currentUserId,
  });

  // Módulo ativo no Menu Lateral: 'tracker' (Rastreamento & Pacotes) ou 'radar' (Radar Top 100 Demanda)
  const [activeModule, setActiveModule] = useState<'tracker' | 'radar'>(
    'tracker'
  );
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

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
  const [checkedPackageIds, setCheckedPackageIds] = useState<Set<string>>(
    new Set()
  );
  const [preselectedModalPackageIds, setPreselectedModalPackageIds] = useState<
    string[]
  >([]);

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

  const [isFetchingCoversBatch, setIsFetchingCoversBatch] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3800);
  };

  // Busca automática de capas em background com paralelismo controlado e única atualização de estado
  const autoPopulateCoversForItems = async (itemsToFetch: CDItem[]) => {
    const foundMap = await fetchCoversInBatch(itemsToFetch, 3);
    if (foundMap.size === 0) return;

    setCdItems((prev) =>
      prev.map((cd) => {
        const best = foundMap.get(cd.id);
        return best
          ? {
              ...cd,
              coverUrl: best.coverUrl,
              releaseYear: cd.releaseYear || best.releaseYear,
            }
          : cd;
      })
    );
  };

  // Calcula os resumos de TODOS os pacotes em O(N)
  const summariesMap = useMemo(() => {
    return calculateAllShipmentSummaries(shipments, cdItems);
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

  const forwarderPackageIdsSet = useMemo(() => {
    return new Set(forwarderPackages.map((fp) => fp.shipment.id));
  }, [forwarderPackages]);

  // Mantém o estado de checkboxes sincronizado caso algum pacote seja consolidado ou removido
  useEffect(() => {
    setCheckedPackageIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (forwarderPackageIdsSet.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [forwarderPackageIdsSet]);

  const checkedConsolidationStats = useMemo(() => {
    let totalCds = 0;
    let validCount = 0;
    for (const fp of forwarderPackages) {
      if (checkedPackageIds.has(fp.shipment.id)) {
        validCount++;
        totalCds += fp.items.length;
      }
    }
    return {
      packageCount: validCount,
      totalCds,
    };
  }, [forwarderPackages, checkedPackageIds]);

  const handleToggleCheckPackage = (
    e: React.MouseEvent,
    shipmentId: string
  ) => {
    e.stopPropagation();
    if (!forwarderPackageIdsSet.has(shipmentId)) return;
    setCheckedPackageIds((prev) => {
      const next = new Set(prev);
      if (next.has(shipmentId)) {
        next.delete(shipmentId);
      } else {
        next.add(shipmentId);
      }
      return next;
    });
  };

  const handleOpenConsolidateFromChecked = () => {
    if (checkedConsolidationStats.packageCount < 2) return;
    setEditingShipment(null);
    setPreselectedModalPackageIds(Array.from(checkedPackageIds));
    setIsShipmentModalOpen(true);
  };

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
      const foundMap = await fetchCoversInBatch(targets, 3);
      if (foundMap.size > 0) {
        setCdItems((prev) =>
          prev.map((cd) => {
            const best = foundMap.get(cd.id);
            return best
              ? {
                  ...cd,
                  coverUrl: best.coverUrl,
                  releaseYear: cd.releaseYear || best.releaseYear,
                }
              : cd;
          })
        );
      }
      showToast(
        foundMap.size > 0
          ? `${foundMap.size} capa(s) encontrada(s) automaticamente!`
          : 'Nenhuma capa nova encontrada. Verifique os nomes dos álbuns.'
      );
    } finally {
      setIsFetchingCoversBatch(false);
    }
  };

  // Salvar edição rápida (inline) do nome do álbum e buscar capa
  const handleSaveInlineEdit = async (
    item: CDItem,
    newArtist: string,
    newAlbum: string
  ) => {
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
  const handleSavePackageTitle = (shipment: Shipment, newTitle: string) => {
    setShipments((prev) =>
      prev.map((s) =>
        s.id === shipment.id
          ? { ...s, name: newTitle, isCustomName: true }
          : s
      )
    );
    showToast('Nome personalizado do pacote salvo e travado!');
  };

  const handleSavePackageWeight = (
    shipmentId: string,
    weightKg: number | undefined
  ) => {
    setShipments((prev) =>
      prev.map((s) => (s.id === shipmentId ? { ...s, weightKg } : s))
    );
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
        (ship.ebayOrderId || '').toLowerCase().includes(q) ||
        (ship.notes || '').toLowerCase().includes(q);

      if (matchShipment) return true;

      const shipCDs = cdItems.filter((cd) => cd.shipmentId === ship.id);
      return shipCDs.some(
        (cd) =>
          cd.artist.toLowerCase().includes(q) ||
          cd.albumTitle.toLowerCase().includes(q) ||
          (cd.localTrackingCode || '').toLowerCase().includes(q) ||
          (cd.ebayOrderId || '').toLowerCase().includes(q) ||
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
        item.albumTitle.toLowerCase().includes(q)
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

    const result = executeConsolidation({
      allShipments: shipments,
      allCdItems: cdItems,
      forwarderPackages,
      targetShipmentData: data,
      targetShipmentId,
      isExistingShipment: Boolean(existingId),
      absorbedPayload: absorbedForwarder,
      newCdEntries: initialBundle?.enabled
        ? initialBundle.entries.map((entry) => ({
            id: entry.id,
            artist: entry.artist,
            albumTitle: entry.albumTitle,
            unitPrice: entry.unitPrice,
            discCount: entry.discCount || 1,
            coverUrl: entry.coverUrl,
            releaseYear: entry.releaseYear,
            ebayListingUrl: entry.ebayListingUrl,
          }))
        : undefined,
      initialBundleInfo: initialBundle?.enabled
        ? {
            enabled: true,
            totalValue: initialBundle.totalValue,
            localTrackingCode: initialBundle.localTrackingCode,
          }
        : undefined,
    });

    setShipments(result.updatedShipments);
    setCdItems(result.updatedCdItems);

    if (result.newlyCreatedCDs.length > 0) {
      autoPopulateCoversForItems(result.newlyCreatedCDs);
    }

    setSelectedShipmentId(targetShipmentId);
    setMobileActivePane('detail');
    if (result.absorbedCount > 0) {
      setCheckedPackageIds(new Set());
      setPreselectedModalPackageIds([]);
    }

    if (result.discardedCount > 0 && result.absorbedCount > 0) {
      showToast(
        `Pacote consolidado (${result.absorbedCount} CDs incluídos e ${result.discardedCount} descartado(s) com custo redistribuído)!`
      );
    } else if (result.absorbedCount > 0 && result.newlyCreatedCDs.length > 0) {
      showToast(
        `Pacote salvo com ${result.absorbedCount} CD(s) do redirecionador + ${result.newlyCreatedCDs.length} CD(s) novo(s)!`
      );
    } else if (result.absorbedCount > 0) {
      showToast(
        `Pacote consolidado com ${result.absorbedCount} CD(s) (status alterado p/ Já Consolidado)!`
      );
    } else if (!existingId && result.newlyCreatedCDs.length > 0) {
      showToast(
        `Pacote criado com ${result.newlyCreatedCDs.length} ${
          result.newlyCreatedCDs.length === 1 ? 'CD lançado' : 'CDs lançados'
        }!`
      );
    } else {
      showToast(
        existingId ? 'Pacote e CDs atualizados!' : 'Novo pacote criado!'
      );
    }
  };

  const handleDuplicateShipment = (shipment: Shipment) => {
    const todayIso = getTodayLocalIsoDate();
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

    const { newShipment, updatedCd } = extractCdToSingleShipment(
      item,
      parentShipment
    );

    setShipments((prev) => [newShipment, ...prev]);
    setCdItems((prev) =>
      prev.map((cd) => (cd.id === item.id ? updatedCd : cd))
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
      <TrackerHeader
        globalStats={globalStats}
        cloudSyncStatus={cloudSyncStatus}
        activeModule={activeModule}
        setActiveModule={setActiveModule}
        activeMainTab={activeMainTab}
        setActiveMainTab={setActiveMainTab}
        packagesCount={shipments.length}
        onForceSync={forceSync}
        onExportBackup={handleExportBackup}
        fileInputRef={fileInputRef}
        onImportBackup={handleImportBackup}
        user={user}
      />

      {/* CORPO COM MENU LATERAL RECOLHÍVEL (SIDEBAR) + CONTEÚDO PRINCIPAL */}
      <div className="flex-1 flex max-w-[1600px] w-full mx-auto">
        {/* MENU LATERAL DESKTOP */}
        <aside
          className={`hidden md:flex flex-col justify-between border-r border-slate-800/80 bg-slate-900/40 shrink-0 transition-all duration-200 ${
            isSidebarCollapsed ? 'w-16' : 'w-60'
          } p-3`}
        >
          <div className="space-y-1.5 sticky top-24">
            <div className="flex items-center justify-between px-2 pb-2 mb-1 border-b border-slate-800/70">
              {!isSidebarCollapsed && (
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Módulos
                </span>
              )}
              <button
                type="button"
                onClick={() => setIsSidebarCollapsed((prev) => !prev)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer mx-auto md:mx-0"
                title={
                  isSidebarCollapsed
                    ? 'Expandir menu lateral'
                    : 'Recolher menu lateral'
                }
              >
                {isSidebarCollapsed ? (
                  <PanelLeftOpen className="w-4 h-4" />
                ) : (
                  <PanelLeftClose className="w-4 h-4" />
                )}
              </button>
            </div>

            <button
              type="button"
              onClick={() => setActiveModule('tracker')}
              title="Rastreamento & Pacotes"
              className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-semibold transition cursor-pointer ${
                activeModule === 'tracker'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/25'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/70'
              }`}
            >
              <Package className="w-4 h-4 shrink-0" />
              {!isSidebarCollapsed && (
                <div className="text-left truncate">
                  <div className="truncate">Rastreamento & Pacotes</div>
                  <div className="text-[10px] font-normal opacity-80 truncate">
                    Importações, Lotes e Rateio
                  </div>
                </div>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveModule('radar')}
              title="Radar Top 100 (Demanda & Arbitragem)"
              className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-semibold transition cursor-pointer ${
                activeModule === 'radar'
                  ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 shadow-lg shadow-amber-500/20'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/70'
              }`}
            >
              <Flame
                className={`w-4 h-4 shrink-0 ${
                  activeModule === 'radar'
                    ? 'text-slate-950'
                    : 'text-amber-400'
                }`}
              />
              {!isSidebarCollapsed && (
                <div className="text-left truncate">
                  <div className="truncate">Radar Top 100</div>
                  <div className="text-[10px] font-normal opacity-80 truncate">
                    Discogs + Mercado Livre BR
                  </div>
                </div>
              )}
            </button>
          </div>
        </aside>

        {/* ÁREA DE CONTEÚDO DO MÓDULO ATIVO */}
        <div className="flex-1 min-w-0 flex flex-col">
          {activeModule === 'radar' ? (
            <main className="flex-1 w-full px-3.5 sm:px-6 py-4 sm:py-6">
              <DemandRadarView />
            </main>
          ) : activeMainTab === 'collection' ? (
            <GlobalCollectionView
              entries={allCollectionEntries}
              totalCollectionCount={globalStats.totalItems}
              searchQuery={collectionSearch}
              onSearchChange={setCollectionSearch}
              statusFilter={collectionStatusFilter}
              onStatusFilterChange={setCollectionStatusFilter}
              sortBy={collectionSortBy}
              onSortByChange={setCollectionSortBy}
              onNavigateToPackage={(shipmentId) => {
                setSelectedShipmentId(shipmentId);
                setActiveMainTab('packages');
                setMobileActivePane('detail');
              }}
            />
          ) : (
        /* =====================================================================
           ABA 1: MAIN SPA MASTER / DETAIL WORKSPACE (VISÃO POR PACOTES)
           ===================================================================== */
        <main className="flex-1 max-w-[1600px] w-full mx-auto px-3.5 sm:px-6 py-4 sm:py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <PackageSidebar
            mobileActivePane={mobileActivePane}
            filteredShipments={filteredShipments}
            totalShipmentsCount={shipments.length}
            checkedConsolidationStats={checkedConsolidationStats}
            onClearCheckedPackages={() => setCheckedPackageIds(new Set())}
            onOpenConsolidateFromChecked={handleOpenConsolidateFromChecked}
            onOpenNewShipmentModal={() => {
              setEditingShipment(null);
              setPreselectedModalPackageIds([]);
              setIsShipmentModalOpen(true);
            }}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            summariesMap={summariesMap}
            selectedShipmentId={selectedShipmentId}
            forwarderPackageIdsSet={forwarderPackageIdsSet}
            checkedPackageIds={checkedPackageIds}
            onToggleCheckPackage={handleToggleCheckPackage}
            onSelectShipment={(shipId) => {
              setSelectedShipmentId(shipId);
              setMobileActivePane('detail');
              if (typeof window !== 'undefined' && window.innerWidth < 1024) {
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }
            }}
          />

          <PackageDetailView
            mobileActivePane={mobileActivePane}
            onBackToList={() => setMobileActivePane('list')}
            filteredShipmentsCount={filteredShipments.length}
            selectedSummary={selectedSummary}
            searchQuery={searchQuery}
            displayedCDItems={displayedCDItems}
            cdSortBy={cdSortBy}
            onCdSortByChange={setCdSortBy}
            isFetchingCoversBatch={isFetchingCoversBatch}
            onFetchAllCovers={handleFetchAllCoversInShipment}
            onOpenNewShipmentModal={() => {
              setEditingShipment(null);
              setIsShipmentModalOpen(true);
            }}
            onEditShipment={(shipment) => {
              setEditingShipment(shipment);
              setIsShipmentModalOpen(true);
            }}
            onDuplicateShipment={handleDuplicateShipment}
            onDeleteShipment={handleDeleteShipment}
            onRevertPackageToSingle={handleRevertPackageToSingle}
            onApplyMgTaxEstimate={handleApplyMgTaxEstimate}
            onQuickStatusChange={handleQuickStatusChange}
            onSavePackageTitle={handleSavePackageTitle}
            onTogglePackageCustomNameLock={handleTogglePackageCustomNameLock}
            onSavePackageWeight={handleSavePackageWeight}
            onOpenAddCD={() => {
              setEditingCD(null);
              setIsCDModalOpen(true);
            }}
            onEditCD={(cd) => {
              setEditingCD(cd);
              setIsCDModalOpen(true);
            }}
            onDeleteCD={handleDeleteCD}
            onExtractCdToSingle={handleExtractCdToSinglePackage}
            onSaveInlineEditCD={handleSaveInlineEdit}
            showToast={showToast}
          />
        </main>
      )}
        </div>
      </div>

      {/* POP-UP 1: MODAL ÚNICO DE CRIAR / EDITAR PACOTE E SEUS CDs */}
      <ShipmentModal
        isOpen={isShipmentModalOpen}
        onClose={() => {
          setIsShipmentModalOpen(false);
          setEditingShipment(null);
          setPreselectedModalPackageIds([]);
        }}
        onSave={handleSaveShipment}
        editingShipment={editingShipment}
        editingShipmentItems={editingShipmentItems}
        forwarderPackages={forwarderPackages}
        initialPreselectedPackageIds={preselectedModalPackageIds}
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
      <ConfirmModal
        dialog={confirmDialog}
        onClose={() =>
          setConfirmDialog((prev) => ({ ...prev, isOpen: false }))
        }
      />
    </div>
  );
}
