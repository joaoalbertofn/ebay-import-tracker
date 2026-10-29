'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  CDItem,
  ConsolidationMode,
  CurrencyCode,
  Shipment,
  ShipmentStatus,
} from '@/types/tracker';
import {
  calculateConsolidationFee,
  calculateInheritedInternalShipping,
  calculateSelectedForwarderCdsValue,
  countSourcePackagesForSelectedCds,
} from '@/lib/domain/consolidation';
import {
  loadFeePresetsForCurrency,
  saveFeePresetsForCurrency,
} from '@/lib/storage/feePresets';
import { useEbayQuickPaste } from '@/hooks/useEbayQuickPaste';
import {
  CURRENCY_META,
  fetchLiveExchangeRate,
  formatOriginalCurrency,
  generatePackageName,
  getTodayLocalIsoDate,
} from '@/lib/calculations';
import {
  AlbumCoverCandidate,
  fetchBestAlbumCover,
  resolveCoverCycleOrFetch,
} from '@/lib/coverArt';
import { extractEbayOrderInfo } from '@/lib/ebayImport';
import { ForwarderConsolidationSection } from '@/components/modals/ForwarderConsolidationSection';
import { CDEntriesBatchTable } from '@/components/modals/CDEntriesBatchTable';
import {
  X,
  Package,
  Calendar,
  Truck,
  ShieldAlert,
  FileText,
  Sparkles,
  Lock,
  Unlock,
  Scale,
} from 'lucide-react';


export interface InitialCDEntry {
  id?: string; // Presente quando representa um CD já existente no pacote em edição
  artist: string;
  albumTitle: string;
  unitPrice: string; // Preço individual deste CD
  discCount?: number;
  coverUrl?: string;
  releaseYear?: string;
  ebayListingUrl?: string;
  isFetchingCover?: boolean;
  coverCandidates?: AlbumCoverCandidate[];
  coverCandidateIndex?: number;
}

export interface InitialBundlePayload {
  enabled: boolean;
  totalValue: number;
  localTrackingCode: string;
  entries: {
    id?: string;
    artist: string;
    albumTitle: string;
    unitPrice?: number;
    discCount?: number;
    coverUrl?: string;
    releaseYear?: string;
    ebayListingUrl?: string;
  }[];
}

export interface AbsorbedForwarderItemsPayload {
  selectedCdIds: string[];
  discardedCdIds: string[];
  mode: Exclude<ConsolidationMode, 'direct'>; // 'group_only' | 'unpack_and_repack'
  inheritedInternalShipping: number;
}

export interface ForwarderPackageOption {
  shipment: Shipment;
  items: CDItem[];
}

interface ShipmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (
    shipmentData: Omit<Shipment, 'id' | 'createdAt'>,
    existingId?: string,
    initialBundle?: InitialBundlePayload,
    absorbedForwarder?: AbsorbedForwarderItemsPayload
  ) => void;
  editingShipment?: Shipment | null;
  editingShipmentItems?: CDItem[];
  forwarderPackages?: ForwarderPackageOption[];
  initialPreselectedPackageIds?: string[];
}

export const STATUS_LABELS: Record<
  ShipmentStatus,
  { label: string; shortLabel: string; badgeClass: string; dotClass: string }
> = {
  comprado: {
    label: 'Comprado (Pacote Único)',
    shortLabel: 'Comprado',
    badgeClass: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
    dotClass: 'bg-purple-400',
  },
  no_redirecionador: {
    label: 'No Redirecionador (Avulso)',
    shortLabel: 'Redirecionador',
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    dotClass: 'bg-amber-400',
  },
  consolidado: {
    label: 'Já Consolidado (Redirecionador)',
    shortLabel: 'Já Consolidado',
    badgeClass: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
    dotClass: 'bg-indigo-400',
  },
  em_transito: {
    label: 'Em Trânsito',
    shortLabel: 'Em Trânsito',
    badgeClass: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    dotClass: 'bg-sky-400',
  },
  tributado: {
    label: 'Tributado (Receita/MG)',
    shortLabel: 'Tributado',
    badgeClass: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    dotClass: 'bg-rose-400',
  },
  entregue: {
    label: 'Entregue',
    shortLabel: 'Entregue',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    dotClass: 'bg-emerald-400',
  },
};

export function ShipmentModal({
  isOpen,
  onClose,
  onSave,
  editingShipment,
  editingShipmentItems = [],
  forwarderPackages = [],
  initialPreselectedPackageIds = [],
}: ShipmentModalProps) {
  const [name, setName] = useState('');
  const [isCustomName, setIsCustomName] = useState(false);
  const [shippingDate, setShippingDate] = useState('');
  const [status, setStatus] = useState<ShipmentStatus>('comprado');
  const [currency, setCurrency] = useState<CurrencyCode>('GBP');
  const [exchangeRate, setExchangeRate] = useState<number>(
    CURRENCY_META.GBP.defaultRate
  );
  const [rateSourceInfo, setRateSourceInfo] = useState<string>(
    'Cotação Automática'
  );
  const [isFetchingLiveRate, setIsFetchingLiveRate] = useState(false);
  const [weightKg, setWeightKg] = useState<string>('');
  const [internalShipping, setInternalShipping] = useState<string>('0');
  const [forwarderFee, setForwarderFee] = useState<string>('0');
  const [internationalShipping, setInternationalShipping] =
    useState<string>('0');
  const [customsTaxBrl, setCustomsTaxBrl] = useState<string>('0');
  const [isTaxEstimated, setIsTaxEstimated] = useState<boolean>(false);
  const [internationalTrackingCode, setInternationalTrackingCode] =
    useState('');
  const [ebayOrderInput, setEbayOrderInput] = useState('');
  const [ebayQuickPasteInput, setEbayQuickPasteInput] = useState('');
  const {
    isParsingEbay,
    ebayImportFeedback,
    setEbayImportFeedback,
    parseEbay,
  } = useEbayQuickPaste();
  const [notes, setNotes] = useState('');

  // Campos para lançar/editar CDs direto no modal do pacote
  const [bundleTotalValue, setBundleTotalValue] = useState<string>('');
  const [localTrackingCode, setLocalTrackingCode] = useState<string>('');
  const [cdEntries, setCdEntries] = useState<InitialCDEntry[]>([
    { artist: '', albumTitle: '', unitPrice: '', discCount: 1 },
  ]);

  // Seleção de pacotes/CDs existentes que estão disponíveis para consolidação + descarte
  const [selectedExistingCdIds, setSelectedExistingCdIds] = useState<
    Set<string>
  >(new Set());
  const [discardedExistingCdIds, setDiscardedExistingCdIds] = useState<
    Set<string>
  >(new Set());
  const [consolidationAction, setConsolidationAction] = useState<
    'group_only' | 'unpack_and_repack'
  >('unpack_and_repack');
  const [groupOnlyFeePreset, setGroupOnlyFeePreset] = useState<string>('3.00');
  const [unpackAndRepackFeePreset, setUnpackAndRepackFeePreset] =
    useState<string>('6.50');
  const [isForwarderExpandedManual, setIsForwarderExpandedManual] =
    useState<boolean>(false);

  // Filtra apenas pacotes disponíveis que não sejam o próprio pacote em edição e que tenham CDs
  const eligibleForwarderPackages = useMemo(() => {
    return forwarderPackages.filter(
      (fp) =>
        fp.shipment.id !== editingShipment?.id && fp.items.length > 0
    );
  }, [forwarderPackages, editingShipment]);

  const syncFeePresetsToState = (curr: CurrencyCode) => {
    const { savedGroup, savedUnpack } = loadFeePresetsForCurrency(curr);
    setGroupOnlyFeePreset(String(savedGroup));
    setUnpackAndRepackFeePreset(String(savedUnpack));
    return { savedGroup, savedUnpack };
  };

  const handleFetchLiveRate = async (targetCurrency: CurrencyCode) => {
    setIsFetchingLiveRate(true);
    try {
      const result = await fetchLiveExchangeRate(targetCurrency);
      setExchangeRate(result.rate);
      setRateSourceInfo(`${result.source} às ${result.timestamp}`);
    } catch {
      setExchangeRate(CURRENCY_META[targetCurrency].defaultRate);
      setRateSourceInfo('Cotação Automática de Referência');
    } finally {
      setIsFetchingLiveRate(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    setSelectedExistingCdIds(new Set());
    setDiscardedExistingCdIds(new Set());
    setConsolidationAction('unpack_and_repack');
    setIsForwarderExpandedManual(false);
    setEbayQuickPasteInput('');
    setEbayImportFeedback(null);

    if (editingShipment) {
      setName(editingShipment.name);
      setIsCustomName(Boolean(editingShipment.isCustomName));
      setShippingDate(editingShipment.shippingDate || getTodayLocalIsoDate());
      setStatus(editingShipment.status);
      setCurrency(editingShipment.currency);
      setExchangeRate(editingShipment.exchangeRate);
      setRateSourceInfo(
        editingShipment.exchangeRateSource || 'Cotação Automática'
      );
      setWeightKg(
        editingShipment.weightKg && editingShipment.weightKg > 0
          ? String(editingShipment.weightKg)
          : ''
      );
      setInternalShipping(String(editingShipment.internalShipping));
      setForwarderFee(String(editingShipment.forwarderFee));
      setInternationalShipping(String(editingShipment.internationalShipping));
      setCustomsTaxBrl(String(editingShipment.customsTaxBrl));
      setIsTaxEstimated(Boolean(editingShipment.isTaxEstimated));
      setInternationalTrackingCode(
        editingShipment.internationalTrackingCode || ''
      );
      setEbayOrderInput(
        editingShipment.ebayOrderUrl || editingShipment.ebayOrderId || ''
      );
      setNotes(editingShipment.notes || '');

      if (editingShipmentItems.length > 0) {
        const totalExisting = editingShipmentItems.reduce(
          (acc, item) => acc + (Number(item.unitOriginalValue) || 0),
          0
        );
        const firstLocalTrack =
          editingShipmentItems.find((i) => i.localTrackingCode)
            ?.localTrackingCode || '';
        setBundleTotalValue(
          totalExisting > 0 ? String(Number(totalExisting.toFixed(2))) : ''
        );
        setLocalTrackingCode(firstLocalTrack);
        setCdEntries(
          editingShipmentItems.map((item) => ({
            id: item.id,
            artist: item.artist,
            albumTitle: item.albumTitle,
            unitPrice:
              item.unitOriginalValue > 0
                ? String(Number(item.unitOriginalValue.toFixed(2)))
                : '',
            discCount: item.discCount || 1,
            coverUrl: item.coverUrl,
            releaseYear: item.releaseYear,
            ebayListingUrl: item.ebayListingUrl,
          }))
        );
      } else {
        setBundleTotalValue('');
        setLocalTrackingCode('');
        setCdEntries([
          { artist: '', albumTitle: '', unitPrice: '', discCount: 1 },
        ]);
      }
      syncFeePresetsToState(editingShipment.currency);
    } else {
      setName('');
      setIsCustomName(false);
      setShippingDate(getTodayLocalIsoDate());
      setStatus('comprado');
      setCurrency('GBP');
      setExchangeRate(CURRENCY_META.GBP.defaultRate);
      setRateSourceInfo('Cotação Automática');
      setWeightKg('');
      setInternalShipping('0');
      setForwarderFee('0');
      setInternationalShipping('0');
      setCustomsTaxBrl('0');
      setIsTaxEstimated(false);
      setInternationalTrackingCode('');
      setEbayOrderInput('');
      setNotes('');
      setBundleTotalValue('');
      setLocalTrackingCode('');
      setCdEntries([
        { artist: '', albumTitle: '', unitPrice: '', discCount: 1 },
      ]);
      const { savedUnpack } = syncFeePresetsToState('GBP');
      handleFetchLiveRate('GBP');

      if (initialPreselectedPackageIds.length > 0) {
        const preselectedSet = new Set(initialPreselectedPackageIds);
        const matchingPackages = forwarderPackages.filter(
          (fp) => preselectedSet.has(fp.shipment.id) && fp.items.length > 0
        );
        const preselectedCdIds = new Set<string>(
          matchingPackages.flatMap((fp) => fp.items.map((cd) => cd.id))
        );

        if (preselectedCdIds.size > 0) {
          setSelectedExistingCdIds(preselectedCdIds);
          setConsolidationAction('unpack_and_repack');
          setStatus('consolidado');
          setIsForwarderExpandedManual(true);
          const pkgCount = Math.max(1, matchingPackages.length);
          const totalFee = Number((pkgCount * savedUnpack).toFixed(2));
          setForwarderFee(String(totalFee));
        }
      }
    }
  }, [
    isOpen,
    editingShipment,
    editingShipmentItems,
    forwarderPackages,
    initialPreselectedPackageIds,
    setEbayImportFeedback,
  ]);

  const handleImportFromEbay = async () => {
    const data = await parseEbay(ebayQuickPasteInput);
    if (!data) return;

    if (data.ebayOrderUrl || data.ebayOrderId) {
      setEbayOrderInput(data.ebayOrderUrl || data.ebayOrderId || '');
    }

    if (data.currency && data.currency !== currency) {
      handleCurrencyChange(data.currency);
    }

    if (data.internalShipping !== undefined && data.internalShipping >= 0) {
      setInternalShipping(String(Number(data.internalShipping.toFixed(2))));
    }

    if (data.localTrackingCode) {
      setLocalTrackingCode(data.localTrackingCode.toUpperCase());
    }

    if (data.items && data.items.length > 0) {
      // Verifica se todos os itens têm preços distintos (compra multi-item) ou se fazem parte de um lote único (bundle)
      const hasDistinctIndividualPrices =
        data.items.length > 1 &&
        data.items.some(
          (item, _, arr) =>
            item.unitPrice !== undefined &&
            arr[0].unitPrice !== undefined &&
            Math.abs(item.unitPrice - arr[0].unitPrice) > 0.01
        );

      const importedEntries: InitialCDEntry[] = data.items.map((item) => ({
        artist: item.artist || '',
        albumTitle: item.albumTitle || item.rawTitle || '',
        unitPrice:
          hasDistinctIndividualPrices &&
          item.unitPrice !== undefined &&
          item.unitPrice >= 0
            ? String(Number(item.unitPrice.toFixed(2)))
            : '',
        discCount: item.discCount || 1,
        coverUrl: item.coverUrl,
        releaseYear: item.releaseYear,
        ebayListingUrl: item.ebayListingUrl,
      }));

      // Mantém apenas CDs já salvos no banco (com id); substitui rascunhos não salvos para não duplicar ao testar várias vezes
      const savedEntries = cdEntries.filter((e) => Boolean(e.id));
      const nextEntries =
        savedEntries.length > 0
          ? [...savedEntries, ...importedEntries]
          : importedEntries;

      setCdEntries(nextEntries);

      if (data.bundleTotalValue !== undefined && data.bundleTotalValue > 0) {
        setBundleTotalValue(String(Number(data.bundleTotalValue.toFixed(2))));
      } else {
        const sumPrices = data.items.reduce(
          (acc, e) => acc + Math.max(0, e.unitPrice || 0),
          0
        );
        if (sumPrices > 0) {
          setBundleTotalValue(String(Number(sumPrices.toFixed(2))));
        }
      }

      // Busca capas de álbum em alta resolução (iTunes/MusicBrainz) em background para os itens importados
      nextEntries.forEach((entry, idx) => {
        if (
          (entry.artist.trim() || entry.albumTitle.trim()) &&
          !entry.albumTitle.startsWith('CD #')
        ) {
          fetchBestAlbumCover(entry.artist, entry.albumTitle)
            .then((best) => {
              if (best?.coverUrl) {
                setCdEntries((curr) =>
                  curr.map((row, rIdx) =>
                    rIdx === idx
                      ? {
                          ...row,
                          coverUrl: best.coverUrl,
                          releaseYear: row.releaseYear || best.releaseYear,
                        }
                      : row
                  )
                );
              }
            })
            .catch(() => {
              // mantém a foto do anúncio se houver
            });
        }
      });

      setEbayQuickPasteInput('');
      setEbayImportFeedback({
        type: 'success',
        text: `${importedEntries.length} ${
          importedEntries.length === 1 ? 'CD importado' : 'CDs importados'
        }${
          data.ebayOrderId ? ` + Pedido #${data.ebayOrderId} vinculado` : ''
        }! Confira os campos abaixo.`,
      });
    } else if (data.warnings && data.warnings.length > 0) {
      setEbayImportFeedback({
        type: 'warning',
        text: data.warnings[0],
      });
    } else if (data.ebayOrderId) {
      setEbayQuickPasteInput('');
      setEbayImportFeedback({
        type: 'success',
        text: `Pedido #${data.ebayOrderId} vinculado ao pacote!`,
      });
    } else {
      setEbayImportFeedback({
        type: 'warning',
        text: 'Nenhum CD ou link do eBay foi identificado. Cole o link do anúncio (ebay.com/itm/...), o link do pedido ou o texto copiado da tela do pedido.',
      });
    }
  };

  const handleCurrencyChange = (newCurr: CurrencyCode) => {
    setCurrency(newCurr);
    setExchangeRate(CURRENCY_META[newCurr].defaultRate);
    const { savedGroup, savedUnpack } = syncFeePresetsToState(newCurr);
    if (selectedExistingCdIds.size > 0) {
      const pkgCount = Math.max(1, selectedSourceShipmentsCount);
      const unitFee =
        consolidationAction === 'group_only' ? savedGroup : savedUnpack;
      setForwarderFee(String(Number((pkgCount * unitFee).toFixed(2))));
    }
    handleFetchLiveRate(newCurr);
  };

  const handleFetchOrCycleCoverForIndex = async (
    index: number,
    cycleNext: boolean = false
  ) => {
    const target = cdEntries[index];
    if (!target) return;

    const isCachedCycle =
      cycleNext &&
      target.coverCandidates &&
      target.coverCandidates.length > 1;

    if (!isCachedCycle) {
      if (!target.artist.trim() && !target.albumTitle.trim()) return;
      setCdEntries((prev) =>
        prev.map((entry, idx) =>
          idx === index ? { ...entry, isFetchingCover: true } : entry
        )
      );
    }

    try {
      const { patch } = await resolveCoverCycleOrFetch(target, cycleNext);
      setCdEntries((prev) =>
        prev.map((entry, idx) =>
          idx === index
            ? { ...entry, ...(patch || {}), isFetchingCover: false }
            : entry
        )
      );
    } catch {
      setCdEntries((prev) =>
        prev.map((entry, idx) =>
          idx === index ? { ...entry, isFetchingCover: false } : entry
        )
      );
    }
  };

  const handleUpdateCdEntry = (
    index: number,
    field: 'artist' | 'albumTitle' | 'unitPrice' | 'discCount',
    value: string
  ) => {
    setCdEntries((prev) => {
      const copy = [...prev];
      const resetCandidates =
        field === 'artist' || field === 'albumTitle'
          ? { coverCandidates: undefined, coverCandidateIndex: undefined }
          : {};
      copy[index] = {
        ...copy[index],
        [field]:
          field === 'discCount'
            ? Math.max(1, parseInt(value, 10) || 1)
            : value,
        ...resetCandidates,
      };

      if (field === 'unitPrice') {
        const hasAnyUnitPrice = copy.some(
          (e) => (parseFloat(e.unitPrice) || 0) > 0
        );
        if (hasAnyUnitPrice) {
          const sum = copy.reduce(
            (acc, e) => acc + Math.max(0, parseFloat(e.unitPrice) || 0),
            0
          );
          setBundleTotalValue(sum > 0 ? String(Number(sum.toFixed(2))) : '');
        }
      }

      return copy;
    });
  };

  const handleAddCdEntryRow = () => {
    setCdEntries((prev) => {
      const lastArtist = prev[prev.length - 1]?.artist || '';
      return [
        ...prev,
        {
          artist: lastArtist,
          albumTitle: '',
          unitPrice: '',
          discCount: 1,
        },
      ];
    });
  };

  const handleRemoveCdEntryRow = (index: number) => {
    setCdEntries((prev) => {
      const next =
        prev.length <= 1
          ? [{ artist: '', albumTitle: '', unitPrice: '', discCount: 1 }]
          : prev.filter((_, idx) => idx !== index);

      const hasAnyUnitPrice = next.some(
        (e) => (parseFloat(e.unitPrice) || 0) > 0
      );
      if (hasAnyUnitPrice) {
        const sum = next.reduce(
          (acc, e) => acc + Math.max(0, parseFloat(e.unitPrice) || 0),
          0
        );
        setBundleTotalValue(sum > 0 ? String(Number(sum.toFixed(2))) : '');
      }
      return next;
    });
  };

  const parsedRate = Math.max(0.0001, Number(exchangeRate) || 1);

  // Calcula o Frete Interno Local herdado proporcionalmente dos pacotes que estão disponíveis para consolidação
  // Considerando a conversão de moeda (caso origem != destino) e a redistribuição dos CDs descartados
  const inheritedInternalShippingFromSelected = useMemo(
    () =>
      calculateInheritedInternalShipping(
        eligibleForwarderPackages,
        selectedExistingCdIds,
        discardedExistingCdIds,
        currency,
        parsedRate
      ),
    [
      eligibleForwarderPackages,
      selectedExistingCdIds,
      discardedExistingCdIds,
      currency,
      parsedRate,
    ]
  );

  // Conta quantos pacotes distintos do redirecionador tiveram itens selecionados
  const selectedSourceShipmentsCount = useMemo(
    () =>
      countSourcePackagesForSelectedCds(
        eligibleForwarderPackages,
        selectedExistingCdIds
      ),
    [eligibleForwarderPackages, selectedExistingCdIds]
  );

  const countSourcePackagesForSet = (cdIdSet: Set<string>): number =>
    countSourcePackagesForSelectedCds(eligibleForwarderPackages, cdIdSet);

  const applyPresetFeeForSelection = (
    nextSelectedSet: Set<string>,
    prevSelectedSize: number,
    actionMode: 'group_only' | 'unpack_and_repack' = consolidationAction
  ) => {
    if (nextSelectedSet.size > 0) {
      const pkgCount = Math.max(1, countSourcePackagesForSet(nextSelectedSet));
      const groupOnlyUnit = parseFloat(groupOnlyFeePreset) || 0;
      const unpackUnit = parseFloat(unpackAndRepackFeePreset) || 0;
      const totalFee = calculateConsolidationFee(
        pkgCount,
        actionMode,
        groupOnlyUnit,
        unpackUnit
      );
      setForwarderFee(String(totalFee));
      if (status === 'comprado' || status === 'no_redirecionador') {
        setStatus('consolidado');
      }
    } else if (
      nextSelectedSet.size === 0 &&
      prevSelectedSize > 0 &&
      !editingShipment
    ) {
      setForwarderFee('0');
      if (status === 'consolidado') {
        setStatus('comprado');
      }
    }
  };

  // Marcar / Desmarcar um pacote inteiro disponível para consolidação (ignorando os marcados para descarte)
  const handleToggleWholeForwarderPackage = (fp: ForwarderPackageOption) => {
    setSelectedExistingCdIds((prev) => {
      const next = new Set(prev);
      const nonDiscardedItems = fp.items.filter(
        (cd) => !discardedExistingCdIds.has(cd.id)
      );
      const allSelected =
        nonDiscardedItems.length > 0 &&
        nonDiscardedItems.every((cd) => next.has(cd.id));
      if (allSelected) {
        nonDiscardedItems.forEach((cd) => next.delete(cd.id));
      } else {
        nonDiscardedItems.forEach((cd) => next.add(cd.id));
      }
      applyPresetFeeForSelection(next, prev.size);
      return next;
    });
  };

  // Marcar / Desmarcar um CD individual de dentro de um pacote disponível para consolidação
  const handleToggleSingleForwarderCd = (cdId: string) => {
    if (discardedExistingCdIds.has(cdId)) {
      // Se estava marcado para descarte, tira do descarte e seleciona para consolidar
      setDiscardedExistingCdIds((prev) => {
        const next = new Set(prev);
        next.delete(cdId);
        return next;
      });
    }
    setSelectedExistingCdIds((prev) => {
      const next = new Set(prev);
      if (next.has(cdId)) {
        next.delete(cdId);
      } else {
        next.add(cdId);
      }
      applyPresetFeeForSelection(next, prev.size);
      return next;
    });
  };

  // Alternar Descarte (Exclusão) de um CD durante a consolidação
  const handleToggleDiscardForwarderCd = (cdId: string) => {
    setDiscardedExistingCdIds((prevDiscarded) => {
      const nextDiscarded = new Set(prevDiscarded);
      const willDiscard = !nextDiscarded.has(cdId);
      if (willDiscard) {
        nextDiscarded.add(cdId);
        setSelectedExistingCdIds((prevSelected) => {
          if (!prevSelected.has(cdId)) return prevSelected;
          const nextSelected = new Set(prevSelected);
          nextSelected.delete(cdId);
          applyPresetFeeForSelection(nextSelected, prevSelected.size);
          return nextSelected;
        });
      } else {
        nextDiscarded.delete(cdId);
      }
      return nextDiscarded;
    });
  };

  const handleSelectAllForwarderPackages = () => {
    setSelectedExistingCdIds((prev) => {
      const allNonDiscardedIds = eligibleForwarderPackages.flatMap((fp) =>
        fp.items
          .filter((cd) => !discardedExistingCdIds.has(cd.id))
          .map((cd) => cd.id)
      );
      const isAllSelected =
        allNonDiscardedIds.length > 0 &&
        allNonDiscardedIds.every((id) => prev.has(id));
      const next = isAllSelected
        ? new Set<string>()
        : new Set<string>(allNonDiscardedIds);
      applyPresetFeeForSelection(next, prev.size);
      return next;
    });
  };

  const currSymbol = CURRENCY_META[currency].symbol;

  // Soma dos preços individuais digitados em cada CD
  const sumOfIndividualPrices = cdEntries.reduce(
    (acc, e) => acc + Math.max(0, parseFloat(e.unitPrice) || 0),
    0
  );
  const hasIndividualPrices = cdEntries.some(
    (e) => (parseFloat(e.unitPrice) || 0) > 0
  );

  const parsedBundleVal = hasIndividualPrices
    ? Number(sumOfIndividualPrices.toFixed(4))
    : Math.max(0, parseFloat(bundleTotalValue) || 0);
  const parsedBundleQty = Math.max(1, cdEntries.length);
  const unitOriginalPreview = parsedBundleVal / parsedBundleQty;

  const hasAnyNewCdFilled =
    parsedBundleVal > 0 ||
    cdEntries.some(
      (e) =>
        Boolean(e.id) ||
        e.artist.trim() !== '' ||
        e.albumTitle.trim() !== '' ||
        (parseFloat(e.unitPrice) || 0) > 0
    );

  const totalInternalShippingEffective =
    Math.max(0, parseFloat(internalShipping) || 0) +
    inheritedInternalShippingFromSelected;

  // Oculta/recolhe automaticamente a seção de consolidação quando o pacote já está Consolidado ou Enviado
  const isAlreadyShippedStatus =
    Boolean(editingShipment) &&
    (status === 'consolidado' ||
      status === 'em_transito' ||
      status === 'tributado' ||
      status === 'entregue');
  const showForwarderBox =
    eligibleForwarderPackages.length > 0 &&
    (!isAlreadyShippedStatus ||
      selectedExistingCdIds.size > 0 ||
      discardedExistingCdIds.size > 0 ||
      isForwarderExpandedManual);

  // Lista combinada de CDs (CDs digitados neste pacote + CDs selecionados da consolidação) para gerar o nome automático
  const selectedForwarderCDs = eligibleForwarderPackages.flatMap((fp) =>
    fp.items.filter((cd) => selectedExistingCdIds.has(cd.id))
  );

  // Soma do valor dos CDs selecionados na consolidação (convertidos para a moeda atual, considerando redistribuição de descartados)
  const selectedForwarderCdsValueInTargetCurr = useMemo(
    () =>
      calculateSelectedForwarderCdsValue(
        eligibleForwarderPackages,
        selectedExistingCdIds,
        discardedExistingCdIds,
        currency,
        parsedRate
      ),
    [
      eligibleForwarderPackages,
      selectedExistingCdIds,
      discardedExistingCdIds,
      currency,
      parsedRate,
    ]
  );

  const filledCdEntries = cdEntries.filter(
    (e) =>
      Boolean(e.id) ||
      e.artist.trim() !== '' ||
      e.albumTitle.trim() !== '' ||
      (parseFloat(e.unitPrice) || 0) > 0
  );

  const combinedItemsForNaming = [
    ...(selectedForwarderCDs.length > 0 ? filledCdEntries : cdEntries),
    ...selectedForwarderCDs,
  ];

  const autoGeneratedName = generatePackageName(
    combinedItemsForNaming,
    editingShipment?.name || name
  );

  const effectivePackageName =
    isCustomName && name.trim() ? name.trim() : autoGeneratedName;

  // Cálculo de peso / métricas de envio no modal
  const totalDiscsPreview =
    filledCdEntries.reduce((acc, e) => acc + (e.discCount || 1), 0) +
    selectedForwarderCDs.reduce((acc, cd) => acc + (cd.discCount || 1), 0);
  const parsedWeightKg = Math.max(0, parseFloat(weightKg) || 0);
  const gramsPerDiscPreview =
    parsedWeightKg > 0 && totalDiscsPreview > 0
      ? Math.round((parsedWeightKg * 1000) / totalDiscsPreview)
      : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (selectedExistingCdIds.size > 0) {
      saveFeePresetsForCurrency(
        currency,
        parseFloat(groupOnlyFeePreset) || 0,
        parseFloat(unpackAndRepackFeePreset) || 0
      );
    }

    const validCdEntries = cdEntries.filter(
      (e) =>
        Boolean(e.id) ||
        e.artist.trim() !== '' ||
        e.albumTitle.trim() !== '' ||
        (parseFloat(e.unitPrice) || 0) > 0
    );

    const fallbackEqualPrice =
      validCdEntries.length > 0 ? parsedBundleVal / validCdEntries.length : 0;

    const resolvedOrderInfo = extractEbayOrderInfo(ebayOrderInput);
    const finalOrderId = resolvedOrderInfo.ebayOrderId || undefined;
    const finalOrderUrl =
      resolvedOrderInfo.ebayOrderUrl ||
      (ebayOrderInput.trim().startsWith('http')
        ? ebayOrderInput.trim()
        : undefined);

    const initialBundle: InitialBundlePayload | undefined =
      hasAnyNewCdFilled || editingShipment
        ? {
            enabled: true,
            totalValue: parsedBundleVal,
            localTrackingCode: localTrackingCode.trim().toUpperCase(),
            entries: validCdEntries.map((entry) => {
              const parsedRowPrice = parseFloat(entry.unitPrice);
              return {
                id: entry.id,
                artist: entry.artist,
                albumTitle: entry.albumTitle,
                unitPrice:
                  !Number.isNaN(parsedRowPrice) && parsedRowPrice >= 0
                    ? parsedRowPrice
                    : fallbackEqualPrice,
                discCount: entry.discCount || 1,
                coverUrl: entry.coverUrl,
                releaseYear: entry.releaseYear,
                ebayListingUrl: entry.ebayListingUrl,
              };
            }),
          }
        : undefined;

    const absorbedForwarder: AbsorbedForwarderItemsPayload | undefined =
      selectedExistingCdIds.size > 0 || discardedExistingCdIds.size > 0
        ? {
            selectedCdIds: Array.from(selectedExistingCdIds),
            discardedCdIds: Array.from(discardedExistingCdIds),
            mode: consolidationAction,
            inheritedInternalShipping: inheritedInternalShippingFromSelected,
          }
        : undefined;

    const parsedForwarderFeeNum = Math.max(0, parseFloat(forwarderFee) || 0);
    const parsedIntShipNum = Math.max(
      0,
      parseFloat(internationalShipping) || 0
    );

    // Se juntou pacotes/CDs ou já informou taxa de redirecionador/frete internacional, garante que não fique como pacote único disponível para consolidar de novo
    let effectiveStatus: ShipmentStatus = status;
    if (
      (selectedExistingCdIds.size > 0 ||
        parsedForwarderFeeNum > 0 ||
        parsedIntShipNum > 0) &&
      (status === 'comprado' || status === 'no_redirecionador') &&
      !editingShipment
    ) {
      effectiveStatus = 'consolidado';
    } else if (
      selectedExistingCdIds.size > 0 &&
      (status === 'comprado' || status === 'no_redirecionador')
    ) {
      effectiveStatus = 'consolidado';
    }

    onSave(
      {
        name: effectivePackageName,
        isCustomName: Boolean(isCustomName && name.trim()),
        shippingDate,
        status: effectiveStatus,
        currency,
        exchangeRate: parsedRate,
        exchangeRateSource: rateSourceInfo,
        consolidationMode:
          selectedExistingCdIds.size > 0
            ? consolidationAction
            : effectiveStatus === 'comprado' ||
              effectiveStatus === 'no_redirecionador'
            ? 'direct'
            : editingShipment?.consolidationMode || 'direct',
        sourcePackagesCount:
          selectedExistingCdIds.size > 0
            ? (editingShipment?.sourcePackagesCount || 0) +
              selectedSourceShipmentsCount
            : editingShipment?.sourcePackagesCount,
        weightKg: parsedWeightKg > 0 ? Number(parsedWeightKg.toFixed(3)) : undefined,
        internalShipping: Number(totalInternalShippingEffective.toFixed(4)),
        forwarderFee: parsedForwarderFeeNum,
        internationalShipping: parsedIntShipNum,
        customsTaxBrl: Math.max(0, parseFloat(customsTaxBrl) || 0),
        isTaxEstimated,
        internationalTrackingCode: internationalTrackingCode.trim(),
        ebayOrderId: finalOrderId,
        ebayOrderUrl: finalOrderUrl,
        notes: notes.trim(),
      },
      editingShipment?.id,
      initialBundle,
      absorbedForwarder
    );
    onClose();
  };

  const allForwarderCdIds = eligibleForwarderPackages.flatMap((fp) =>
    fp.items
      .filter((cd) => !discardedExistingCdIds.has(cd.id))
      .map((cd) => cd.id)
  );
  const areAllForwarderSelected =
    allForwarderCdIds.length > 0 &&
    allForwarderCdIds.every((id) => selectedExistingCdIds.has(id));

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4">
      <div className="relative w-full max-w-3xl max-h-[94dvh] sm:max-h-[90vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-slate-900 border-t sm:border border-slate-700/80 shadow-2xl overflow-hidden">
        {/* Header Fixo com Identificação Automática ou Nome Personalizado */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 bg-slate-800/80 border-b border-slate-700/70 shrink-0 gap-3">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-400 shrink-0">
              <Package className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base sm:text-lg font-semibold text-white truncate">
                {editingShipment
                  ? 'Editar Pacote e CDs'
                  : 'Novo Pacote de Importação'}
              </h2>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="text"
                  value={isCustomName ? name : autoGeneratedName}
                  onChange={(e) => {
                    setName(e.target.value);
                    setIsCustomName(true);
                  }}
                  placeholder={autoGeneratedName}
                  title="Digite para definir um nome personalizado ou use o botão ao lado para alternar entre Automático e Personalizado"
                  className={`flex-1 min-w-0 rounded-lg px-2.5 py-1 text-xs font-medium border focus:outline-none transition ${
                    isCustomName
                      ? 'bg-slate-950 border-amber-500/60 text-amber-200'
                      : 'bg-slate-950/60 border-slate-700/80 text-indigo-300'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (isCustomName) {
                      setIsCustomName(false);
                      setName(autoGeneratedName);
                    } else {
                      setName(autoGeneratedName);
                      setIsCustomName(true);
                    }
                  }}
                  title={
                    isCustomName
                      ? 'Nome travado manualmente. Clique para voltar ao nome automático.'
                      : 'Nome gerado automaticamente pelos CDs. Clique para travar um nome personalizado.'
                  }
                  className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium border shrink-0 transition ${
                    isCustomName
                      ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 hover:bg-amber-500/25'
                      : 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/25'
                  }`}
                >
                  {isCustomName ? (
                    <>
                      <Lock className="w-3 h-3" />
                      <span className="hidden sm:inline">Personalizado</span>
                    </>
                  ) : (
                    <>
                      <Unlock className="w-3 h-3" />
                      <span className="hidden sm:inline">Automático</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar modal"
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          {/* Corpo com Scroll */}
          <div className="p-4 sm:p-6 space-y-5 overflow-y-auto flex-1">
            <CDEntriesBatchTable
              editingShipment={editingShipment}
              cdEntries={cdEntries}
              currency={currency}
              currSymbol={currSymbol}
              exchangeRate={exchangeRate}
              isCustomName={isCustomName}
              effectivePackageName={effectivePackageName}
              autoGeneratedName={autoGeneratedName}
              selectedExistingCdIdsSize={selectedExistingCdIds.size}
              bundleTotalValue={bundleTotalValue}
              bundleLocalTracking={localTrackingCode}
              hasIndividualPrices={hasIndividualPrices}
              parsedBundleVal={parsedBundleVal}
              parsedBundleQty={parsedBundleQty}
              unitOriginalPreview={unitOriginalPreview}
              parsedRate={parsedRate}
              ebayQuickPasteInput={ebayQuickPasteInput}
              isParsingEbay={isParsingEbay}
              ebayImportFeedback={ebayImportFeedback}
              isLoadingRate={isFetchingLiveRate}
              onAddCdEntryRow={handleAddCdEntryRow}
              onRemoveCdEntryRow={handleRemoveCdEntryRow}
              onUpdateCdEntry={handleUpdateCdEntry}
              onFetchOrCycleCover={handleFetchOrCycleCoverForIndex}
              onEbayQuickPasteChange={setEbayQuickPasteInput}
              onImportFromEbay={handleImportFromEbay}
              onChangeCurrency={(newCurr) => {
                setCurrency(newCurr);
                setIsCustomName(false);
              }}
              onChangeExchangeRate={setExchangeRate}
              onRefreshExchangeRate={() => handleFetchLiveRate(currency)}
              onChangeBundleTotalValue={setBundleTotalValue}
              onChangeBundleLocalTracking={setLocalTrackingCode}
            />

            <ForwarderConsolidationSection
              eligibleForwarderPackages={eligibleForwarderPackages}
              showForwarderBox={showForwarderBox}
              isForwarderExpandedManual={isForwarderExpandedManual}
              setIsForwarderExpandedManual={setIsForwarderExpandedManual}
              selectedExistingCdIds={selectedExistingCdIds}
              discardedExistingCdIds={discardedExistingCdIds}
              areAllForwarderSelected={areAllForwarderSelected}
              allForwarderCdIdsLength={allForwarderCdIds.length}
              isAlreadyShippedStatus={isAlreadyShippedStatus}
              currency={currency}
              currSymbol={currSymbol}
              selectedSourceShipmentsCount={selectedSourceShipmentsCount}
              selectedForwarderCdsValueInTargetCurr={
                selectedForwarderCdsValueInTargetCurr
              }
              inheritedInternalShippingFromSelected={
                inheritedInternalShippingFromSelected
              }
              forwarderFee={forwarderFee}
              parsedRate={parsedRate}
              consolidationAction={consolidationAction}
              groupOnlyFeePreset={groupOnlyFeePreset}
              unpackAndRepackFeePreset={unpackAndRepackFeePreset}
              onSelectAllForwarderPackages={handleSelectAllForwarderPackages}
              onToggleWholeForwarderPackage={handleToggleWholeForwarderPackage}
              onToggleSingleForwarderCd={handleToggleSingleForwarderCd}
              onToggleDiscardForwarderCd={handleToggleDiscardForwarderCd}
              onSelectConsolidationAction={(action, unitFee) => {
                setConsolidationAction(action);
                const pkgCount = Math.max(1, selectedSourceShipmentsCount);
                setForwarderFee(String(Number((pkgCount * unitFee).toFixed(2))));
              }}
              onChangeGroupOnlyPreset={(preset) => {
                setGroupOnlyFeePreset(preset);
                setConsolidationAction('group_only');
                const pkgCount = Math.max(1, selectedSourceShipmentsCount);
                const unitFee = parseFloat(preset) || 0;
                setForwarderFee(String(Number((pkgCount * unitFee).toFixed(2))));
              }}
              onChangeUnpackAndRepackPreset={(preset) => {
                setUnpackAndRepackFeePreset(preset);
                setConsolidationAction('unpack_and_repack');
                const pkgCount = Math.max(1, selectedSourceShipmentsCount);
                const unitFee = parseFloat(preset) || 0;
                setForwarderFee(String(Number((pkgCount * unitFee).toFixed(2))));
              }}
            />

            {/* =====================================================================
                BLOCO 3: STATUS, DATA DE COMPRA, PESO (KG), FRETES E ALFÂNDEGA
                ===================================================================== */}
            <div className="rounded-xl bg-slate-800/40 border border-slate-700/60 p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
                  <Truck className="w-4 h-4" /> Status, Peso, Fretes e Alfândega
                </span>
                <span className="text-[11px] text-slate-400">
                  Fretes e peso podem ficar zerados até fechar a caixa
                </span>
              </div>

              {/* Status do Pacote + Data de Compra + Peso em kg */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Status do Pacote
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as ShipmentStatus)}
                    className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-base sm:text-sm text-white focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="comprado">
                      🛒 Comprado (Pacote Único)
                    </option>
                    <option value="no_redirecionador">
                      📍 No Redirecionador (Avulso)
                    </option>
                    <option value="consolidado">
                      📦 Já Consolidado (No Redirecionador)
                    </option>
                    <option value="em_transito">✈️ Em Trânsito</option>
                    <option value="tributado">🧾 Tributado (Receita/MG)</option>
                    <option value="entregue">✅ Entregue</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    <span className="inline-flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" /> Data de
                      Compra
                    </span>
                  </label>
                  <input
                    type="date"
                    value={shippingDate}
                    onChange={(e) => setShippingDate(e.target.value)}
                    className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-base sm:text-sm text-white focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    <span className="inline-flex items-center gap-1.5">
                      <Scale className="w-3.5 h-3.5 text-emerald-400" /> Peso do
                      Pacote (kg)
                    </span>
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Ex: 0.80 ou 1.00"
                      value={weightKg}
                      onChange={(e) => setWeightKg(e.target.value)}
                      className="w-full rounded-xl bg-slate-950 border border-slate-700 pl-3 pr-9 py-2 text-base sm:text-sm text-white font-mono focus:border-indigo-500 focus:outline-none"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-400">
                      kg
                    </span>
                  </div>
                  {gramsPerDiscPreview !== null && (
                    <p className="text-[10px] text-emerald-400 mt-1 font-mono">
                      {totalDiscsPreview} discos • ~{gramsPerDiscPreview} g/CD
                    </p>
                  )}
                </div>
              </div>

              {/* Fretes na Moeda Original */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div>
                  <label className="block text-xs text-slate-300 mb-1">
                    Frete Local eBay
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-400">
                      {currSymbol}
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={internalShipping}
                      onChange={(e) => setInternalShipping(e.target.value)}
                      className="w-full rounded-xl bg-slate-950 border border-slate-700 pl-7 pr-3 py-2 text-base sm:text-sm text-white font-mono focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  {inheritedInternalShippingFromSelected > 0 ? (
                    <p className="text-[10px] text-emerald-400 mt-1 font-mono">
                      +{' '}
                      {formatOriginalCurrency(
                        inheritedInternalShippingFromSelected,
                        currency
                      )}{' '}
                      herdado dos pacotes
                    </p>
                  ) : (
                    <p className="text-[10px] text-slate-500 mt-1">
                      Vendedor → Redirecionador
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs text-slate-300 mb-1">
                    Taxa Redirecionador
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-400">
                      {currSymbol}
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={forwarderFee}
                      onChange={(e) => setForwarderFee(e.target.value)}
                      className="w-full rounded-xl bg-slate-950 border border-slate-700 pl-7 pr-3 py-2 text-base sm:text-sm text-white font-mono focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">
                    Consolidação / redirecionamento
                  </p>
                </div>

                <div>
                  <label className="block text-xs text-slate-300 mb-1">
                    Frete Internacional
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-400">
                      {currSymbol}
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={internationalShipping}
                      onChange={(e) => setInternationalShipping(e.target.value)}
                      className="w-full rounded-xl bg-slate-950 border border-slate-700 pl-7 pr-3 py-2 text-base sm:text-sm text-white font-mono focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">
                    Redirecionador → Brasil
                  </p>
                </div>
              </div>

              {/* Divisória sutil: Alfândega BR (em R$) e Rastreamento Internacional */}
              <div className="pt-3 border-t border-slate-700/60 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs text-amber-300 font-medium mb-1 flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                    Taxa de Importação / Alfândega (em R$)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono text-amber-300">
                      R$
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={customsTaxBrl}
                      onChange={(e) => {
                        setCustomsTaxBrl(e.target.value);
                        setIsTaxEstimated(false);
                      }}
                      className="w-full rounded-xl bg-slate-950 border border-slate-700 pl-9 pr-3 py-2 text-base sm:text-sm text-white font-mono focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <label className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isTaxEstimated}
                      onChange={(e) => setIsTaxEstimated(e.target.checked)}
                      className="rounded border-slate-600 bg-slate-900 text-indigo-500"
                    />
                    <Sparkles className="w-3 h-3 text-amber-400" /> Valor ainda
                    é estimativa
                  </label>
                </div>

                <div>
                  <label className="block text-xs text-slate-300 mb-1">
                    Código de Rastreio Internacional (BR)
                  </label>
                  <input
                    type="text"
                    placeholder="Ex: LT497056434GB"
                    value={internationalTrackingCode}
                    onChange={(e) =>
                      setInternationalTrackingCode(e.target.value.toUpperCase())
                    }
                    className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3.5 py-2 text-base sm:text-sm text-white font-mono uppercase placeholder-slate-600 focus:border-indigo-500 focus:outline-none"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Código Correios / 17TRACK até sua casa
                  </p>
                </div>
              </div>
            </div>

            {/* Observações */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-slate-400" /> Observações
                do Pacote (Opcional)
              </label>
              <textarea
                rows={2}
                placeholder="Anote detalhes do redirecionador, peso da caixa, leilões pendentes..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3.5 py-2 text-base sm:text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Footer Sempre Fixo e Visível */}
          <div className="flex items-center justify-end gap-3 px-4 sm:px-6 py-3.5 sm:py-4 bg-slate-900 border-t border-slate-800 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/25 transition"
            >
              {editingShipment
                ? 'Salvar Alterações'
                : selectedExistingCdIds.size > 0
                ? `Criar Pacote (${
                    selectedExistingCdIds.size +
                    (hasAnyNewCdFilled ? parsedBundleQty : 0)
                  } CDs)`
                : 'Criar Pacote'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
