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
  CURRENCY_META,
  fetchLiveExchangeRate,
  formatBrl,
  formatOriginalCurrency,
  generatePackageName,
  getTodayLocalIsoDate,
} from '@/lib/calculations';
import {
  AlbumCoverCandidate,
  fetchBestAlbumCover,
  resolveCoverCycleOrFetch,
} from '@/lib/coverArt';
import {
  EbayImportResult,
  extractEbayOrderInfo,
} from '@/lib/ebayImport';
import { AlbumCover } from '@/components/AlbumCover';
import {
  X,
  Package,
  Calendar,
  Coins,
  Truck,
  ShieldAlert,
  FileText,
  Sparkles,
  Disc3,
  CheckSquare,
  Square,
  PackageOpen,
  PackageCheck,
  Plus,
  Trash2,
  Loader2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Lock,
  Unlock,
  Scale,
  RotateCcw,
  ExternalLink,
  Link2,
} from 'lucide-react';

const STORAGE_KEY_FEES = 'cd_import_tracker_forwarder_fees_v1';

interface SavedForwarderFees {
  [currency: string]: {
    groupOnlyFee: number;
    unpackAndRepackFee: number;
  };
}

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
  const [isParsingEbay, setIsParsingEbay] = useState(false);
  const [ebayImportFeedback, setEbayImportFeedback] = useState<{
    type: 'success' | 'warning';
    text: string;
  } | null>(null);
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

  const loadFeePresetsForCurrency = (curr: CurrencyCode) => {
    let savedGroup = CURRENCY_META[curr].defaultGroupOnlyFee;
    let savedUnpack = CURRENCY_META[curr].defaultUnpackAndRepackFee;
    try {
      const raw = localStorage.getItem(STORAGE_KEY_FEES);
      if (raw) {
        const parsed: SavedForwarderFees = JSON.parse(raw);
        if (parsed[curr]) {
          savedGroup = parsed[curr].groupOnlyFee;
          savedUnpack = parsed[curr].unpackAndRepackFee;
        }
      }
    } catch {
      // ignora
    }
    setGroupOnlyFeePreset(String(savedGroup));
    setUnpackAndRepackFeePreset(String(savedUnpack));
    return { savedGroup, savedUnpack };
  };

  const handleFetchLiveRate = async (targetCurrency: CurrencyCode) => {
    try {
      const result = await fetchLiveExchangeRate(targetCurrency);
      setExchangeRate(result.rate);
      setRateSourceInfo(`${result.source} às ${result.timestamp}`);
    } catch {
      setExchangeRate(CURRENCY_META[targetCurrency].defaultRate);
      setRateSourceInfo('Cotação Automática de Referência');
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
      loadFeePresetsForCurrency(editingShipment.currency);
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
      loadFeePresetsForCurrency('GBP');
      handleFetchLiveRate('GBP');
    }
  }, [isOpen, editingShipment, editingShipmentItems]);

  const handleImportFromEbay = async () => {
    const raw = ebayQuickPasteInput.trim();
    if (!raw) return;

    setIsParsingEbay(true);
    setEbayImportFeedback(null);

    try {
      const res = await fetch('/api/ebay/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: raw }),
      });

      const data: EbayImportResult & { error?: string } = await res.json();

      if (!res.ok || data.error) {
        setEbayImportFeedback({
          type: 'warning',
          text: data.error || 'Não foi possível ler os dados informados.',
        });
        return;
      }

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
        const importedEntries: InitialCDEntry[] = data.items.map((item) => ({
          artist: item.artist || '',
          albumTitle: item.albumTitle || item.rawTitle || '',
          unitPrice:
            item.unitPrice !== undefined && item.unitPrice >= 0
              ? String(Number(item.unitPrice.toFixed(2)))
              : '',
          discCount: item.discCount || 1,
          coverUrl: item.coverUrl,
          releaseYear: item.releaseYear,
          ebayListingUrl: item.ebayListingUrl,
        }));

        // Se a primeira linha atual estiver vazia, substitui; caso contrário, adiciona ao final
        const isCurrentEmpty =
          cdEntries.length === 1 &&
          !cdEntries[0].id &&
          !cdEntries[0].artist.trim() &&
          !cdEntries[0].albumTitle.trim() &&
          !cdEntries[0].unitPrice.trim();

        const nextEntries = isCurrentEmpty
          ? importedEntries
          : [...cdEntries, ...importedEntries];

        setCdEntries(nextEntries);

        const sumPrices = nextEntries.reduce(
          (acc, e) => acc + Math.max(0, parseFloat(e.unitPrice) || 0),
          0
        );
        if (sumPrices > 0) {
          setBundleTotalValue(String(Number(sumPrices.toFixed(2))));
        }

        // Busca capas de álbum em alta resolução (iTunes/MusicBrainz) em background para os itens importados
        nextEntries.forEach((entry, idx) => {
          if (entry.artist.trim() || entry.albumTitle.trim()) {
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
    } catch {
      setEbayImportFeedback({
        type: 'warning',
        text: 'Falha ao consultar dados do eBay. Verifique o link ou texto colado.',
      });
    } finally {
      setIsParsingEbay(false);
    }
  };

  const handleCurrencyChange = (newCurr: CurrencyCode) => {
    setCurrency(newCurr);
    setExchangeRate(CURRENCY_META[newCurr].defaultRate);
    const { savedGroup, savedUnpack } = loadFeePresetsForCurrency(newCurr);
    if (selectedExistingCdIds.size > 0) {
      setForwarderFee(
        String(
          consolidationAction === 'group_only' ? savedGroup : savedUnpack
        )
      );
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

  const handleSetCdCount = (val: string) => {
    const num = Math.min(30, Math.max(1, parseInt(val, 10) || 1));
    setCdEntries((prev) => {
      const next: InitialCDEntry[] = [];
      const defaultArtist = prev[0]?.artist || '';
      for (let i = 0; i < num; i++) {
        next.push(
          prev[i] || {
            artist: defaultArtist,
            albumTitle: '',
            unitPrice: '',
            discCount: 1,
          }
        );
      }
      return next;
    });
  };

  const parsedRate = Math.max(0.0001, Number(exchangeRate) || 1);

  // Calcula o Frete Interno Local herdado proporcionalmente dos pacotes que estão disponíveis para consolidação
  // Considerando a conversão de moeda (caso origem != destino) e a redistribuição dos CDs descartados
  const inheritedInternalShippingFromSelected = useMemo(() => {
    if (selectedExistingCdIds.size === 0) return 0;
    let inherited = 0;
    for (const fp of eligibleForwarderPackages) {
      const keptItemsInPkg = fp.items.filter(
        (cd) => !discardedExistingCdIds.has(cd.id)
      );
      const keptCount = keptItemsInPkg.length;
      if (keptCount === 0) continue;

      const selectedCdsInPkg = keptItemsInPkg.filter((cd) =>
        selectedExistingCdIds.has(cd.id)
      ).length;
      if (selectedCdsInPkg === 0) continue;

      const shipLevelInternal = Number(fp.shipment.internalShipping) || 0;
      if (shipLevelInternal > 0) {
        const sourceRate =
          Number(fp.shipment.exchangeRate) ||
          CURRENCY_META[fp.shipment.currency]?.defaultRate ||
          1;
        const conversionFactor =
          fp.shipment.currency === currency ? 1 : sourceRate / parsedRate;

        inherited +=
          shipLevelInternal *
          conversionFactor *
          (selectedCdsInPkg / keptCount);
      }
    }
    return Number(inherited.toFixed(4));
  }, [
    eligibleForwarderPackages,
    selectedExistingCdIds,
    discardedExistingCdIds,
    currency,
    parsedRate,
  ]);

  // Conta quantos pacotes distintos do redirecionador tiveram itens selecionados
  const selectedSourceShipmentsCount = useMemo(() => {
    let count = 0;
    for (const fp of eligibleForwarderPackages) {
      if (fp.items.some((cd) => selectedExistingCdIds.has(cd.id))) {
        count++;
      }
    }
    return count;
  }, [eligibleForwarderPackages, selectedExistingCdIds]);

  const applyPresetFeeIfSelectionChanged = (
    nextSelectedSize: number,
    prevSelectedSize: number,
    actionMode: 'group_only' | 'unpack_and_repack' = consolidationAction
  ) => {
    if (nextSelectedSize > 0 && prevSelectedSize === 0) {
      const feeToApply =
        actionMode === 'group_only'
          ? groupOnlyFeePreset
          : unpackAndRepackFeePreset;
      setForwarderFee(feeToApply);
      if (status === 'comprado' || status === 'no_redirecionador') {
        setStatus('consolidado');
      }
    } else if (
      nextSelectedSize === 0 &&
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
      applyPresetFeeIfSelectionChanged(next.size, prev.size);
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
      applyPresetFeeIfSelectionChanged(next.size, prev.size);
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
          applyPresetFeeIfSelectionChanged(
            nextSelected.size,
            prevSelected.size
          );
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
      applyPresetFeeIfSelectionChanged(next.size, prev.size);
      return next;
    });
  };

  if (!isOpen) return null;

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
      try {
        const raw = localStorage.getItem(STORAGE_KEY_FEES);
        const parsed: SavedForwarderFees = raw ? JSON.parse(raw) : {};
        parsed[currency] = {
          groupOnlyFee: Math.max(0, parseFloat(groupOnlyFeePreset) || 0),
          unpackAndRepackFee: Math.max(
            0,
            parseFloat(unpackAndRepackFeePreset) || 0
          ),
        };
        localStorage.setItem(STORAGE_KEY_FEES, JSON.stringify(parsed));
      } catch {
        // ignora
      }
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
            {/* =====================================================================
                BLOCO 1 (TOPO): CDs DESTE PACOTE + MOEDA E CÂMBIO AUTOMÁTICO
                ===================================================================== */}
            <div className="rounded-xl bg-purple-950/20 border border-purple-500/35 p-4 space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-purple-300 flex items-center gap-1.5">
                    <Disc3 className="w-4 h-4 text-purple-400" />
                    {editingShipment
                      ? `CDs deste Pacote (${cdEntries.length})`
                      : selectedExistingCdIds.size > 0
                      ? `Adicionar também Novos CDs (${currSymbol})`
                      : `CDs deste Pacote (${currency})`}
                  </span>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {isCustomName ? (
                      <>
                        Nome personalizado travado:{' '}
                        <strong className="text-amber-300">
                          {effectivePackageName}
                        </strong>
                      </>
                    ) : (
                      <>
                        O nome do pacote (
                        <strong className="text-slate-200">
                          {autoGeneratedName}
                        </strong>
                        ) é gerado automaticamente pelos CDs abaixo.
                      </>
                    )}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleAddCdEntryRow}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-purple-600/30 hover:bg-purple-600/50 border border-purple-400/40 px-3 py-1.5 text-xs font-semibold text-purple-200 transition"
                >
                  <Plus className="w-3.5 h-3.5" /> Adicionar CD
                </button>
              </div>

              {/* ⚡ Preenchimento Rápido do eBay (Link do Anúncio, Link do Pedido ou Texto do Pedido) */}
              <div className="rounded-xl bg-slate-950/85 border border-indigo-500/35 p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-indigo-300 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                    ⚡ Importar Rápido do eBay (Anúncio ou Pedido)
                  </span>
                  <span className="text-[10px] text-slate-400">
                    Cole link(s) <code className="text-indigo-300">ebay.../itm/...</code>, link <code className="text-indigo-300">order.ebay.com/...</code> ou texto copiado do pedido
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <textarea
                    rows={1}
                    placeholder="Cole aqui o link do anúncio (ebay.co.uk/itm/...), link do pedido ou texto copiado do pedido..."
                    value={ebayQuickPasteInput}
                    onChange={(e) => setEbayQuickPasteInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleImportFromEbay();
                      }
                    }}
                    className="flex-1 rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-indigo-400 focus:outline-none resize-y min-h-[38px]"
                  />
                  <button
                    type="button"
                    onClick={handleImportFromEbay}
                    disabled={isParsingEbay || !ebayQuickPasteInput.trim()}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 px-4 py-2 text-xs font-semibold text-white transition shrink-0"
                  >
                    {isParsingEbay ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Lendo eBay...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        Preencher Dados
                      </>
                    )}
                  </button>
                </div>
                {ebayImportFeedback && (
                  <p
                    className={`text-[11px] px-2.5 py-1.5 rounded-lg border ${
                      ebayImportFeedback.type === 'success'
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                        : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                    }`}
                  >
                    {ebayImportFeedback.text}
                  </p>
                )}
              </div>

              {/* Linha de Moeda/Câmbio + Valor Total, Qtd de CDs e Rastreio Local */}
              <div className="grid grid-cols-2 sm:grid-cols-12 gap-3">
                {/* Moeda e Câmbio Automático */}
                <div className="col-span-2 sm:col-span-4">
                  <label className="block text-xs text-slate-300 mb-1">
                    <span className="inline-flex items-center gap-1">
                      <Coins className="w-3.5 h-3.5 text-amber-400" /> Moeda (
                      {parsedRate.toFixed(2)} R$)
                    </span>
                  </label>
                  <select
                    value={currency}
                    onChange={(e) =>
                      handleCurrencyChange(e.target.value as CurrencyCode)
                    }
                    title={`${rateSourceInfo} (1 ${currency} ≈ R$ ${parsedRate.toFixed(
                      2
                    )})`}
                    className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-base sm:text-sm text-white focus:border-purple-400 focus:outline-none"
                  >
                    {Object.entries(CURRENCY_META).map(([code, meta]) => (
                      <option key={code} value={code}>
                        {code} ({meta.symbol}) ≈ R${' '}
                        {code === currency
                          ? parsedRate.toFixed(2)
                          : meta.defaultRate.toFixed(2)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="col-span-1 sm:col-span-3">
                  <label className="block text-xs text-slate-300 mb-1">
                    Valor Total ({currSymbol})
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono text-purple-300">
                      {currSymbol}
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Soma / lote"
                      value={
                        hasIndividualPrices
                          ? String(Number(sumOfIndividualPrices.toFixed(2)))
                          : bundleTotalValue
                      }
                      onChange={(e) => {
                        const val = e.target.value;
                        setBundleTotalValue(val);
                        if (hasIndividualPrices) {
                          setCdEntries((prev) =>
                            prev.map((item) => ({ ...item, unitPrice: '' }))
                          );
                        }
                      }}
                      className="w-full rounded-xl bg-slate-950 border border-purple-500/50 pl-7 pr-2.5 py-2 text-base sm:text-sm text-white font-mono focus:border-purple-400 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="col-span-1 sm:col-span-2">
                  <label className="block text-xs text-slate-300 mb-1">
                    Qtd. CDs
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={cdEntries.length}
                    onChange={(e) => handleSetCdCount(e.target.value)}
                    className="w-full rounded-xl bg-slate-950 border border-slate-700 px-2.5 py-2 text-base sm:text-sm text-white font-mono text-center focus:border-purple-400 focus:outline-none"
                  />
                </div>

                <div className="col-span-2 sm:col-span-3">
                  <label className="block text-xs text-slate-300 mb-1">
                    Rastreio Local (Opc.)
                  </label>
                  <input
                    type="text"
                    placeholder="Ex: RM123456GB"
                    value={localTrackingCode}
                    onChange={(e) =>
                      setLocalTrackingCode(e.target.value.toUpperCase())
                    }
                    className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-base sm:text-sm text-white font-mono uppercase placeholder-slate-600 focus:border-purple-400 focus:outline-none"
                  />
                </div>

                {/* Campo dedicado para Link ou Número do Pedido eBay */}
                <div className="col-span-2 sm:col-span-12">
                  <label className="block text-xs text-slate-300 mb-1 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1">
                      <Link2 className="w-3.5 h-3.5 text-sky-400" /> Link ou Nº do Pedido no eBay (Opcional)
                    </span>
                    {(() => {
                      const info = extractEbayOrderInfo(ebayOrderInput);
                      const href =
                        info.ebayOrderUrl ||
                        (ebayOrderInput.trim().startsWith('http')
                          ? ebayOrderInput.trim()
                          : '');
                      if (!href) return null;
                      return (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-mono text-sky-300 hover:text-sky-200 underline"
                        >
                          {info.ebayOrderId
                            ? `Abrir Pedido #${info.ebayOrderId}`
                            : 'Abrir Pedido no eBay'}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      );
                    })()}
                  </label>
                  <input
                    type="text"
                    placeholder="Ex: https://order.ebay.com/ord/show?orderId=04-15363-94135... ou apenas 04-15363-94135"
                    value={ebayOrderInput}
                    onChange={(e) => setEbayOrderInput(e.target.value)}
                    className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-white font-mono placeholder-slate-600 focus:border-purple-400 focus:outline-none"
                  />
                </div>
              </div>

              {/* Lista de Linhas de CD (Responsiva no Mobile e Desktop + Nº de Discos) */}
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {cdEntries.map((entry, idx) => {
                  const totalCands = entry.coverCandidates?.length || 0;
                  const currentCandNum = (entry.coverCandidateIndex ?? 0) + 1;

                  return (
                    <div
                      key={entry.id || idx}
                      className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-xl bg-slate-950/90 border border-slate-800 p-2.5"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {/* Miniatura da Capa */}
                        <button
                          type="button"
                          onClick={() =>
                            handleFetchOrCycleCoverForIndex(idx, true)
                          }
                          title={
                            totalCands > 1
                              ? `Trocar capa (Opção ${currentCandNum} de ${totalCands})`
                              : 'Buscar opções de capa deste álbum'
                          }
                          className="relative h-11 w-11 rounded-lg bg-slate-900 border border-slate-700 flex items-center justify-center overflow-hidden shrink-0 hover:border-purple-400 transition"
                        >
                          {entry.isFetchingCover ? (
                            <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                          ) : (
                            <>
                              <AlbumCover
                                src={entry.coverUrl}
                                alt={entry.albumTitle || 'Capa'}
                                iconClassName="w-5 h-5 text-slate-600 hover:text-purple-400"
                              />
                              {entry.coverUrl && totalCands > 1 && (
                                <span className="absolute bottom-0 right-0 bg-black/80 text-[8px] font-mono text-purple-200 px-1 rounded-tl">
                                  {currentCandNum}/{totalCands}
                                </span>
                              )}
                            </>
                          )}
                        </button>

                        {/* Inputs Banda & Disco */}
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 flex-1 min-w-0">
                          <div className="sm:col-span-5">
                            <input
                              type="text"
                              placeholder="Artista / Banda"
                              value={entry.artist}
                              onChange={(e) =>
                                handleUpdateCdEntry(
                                  idx,
                                  'artist',
                                  e.target.value
                                )
                              }
                              onBlur={() => {
                                if (
                                  entry.artist.trim() &&
                                  entry.albumTitle.trim() &&
                                  !entry.coverUrl
                                ) {
                                  handleFetchOrCycleCoverForIndex(idx, false);
                                }
                              }}
                              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-2 text-base sm:text-xs text-white placeholder-slate-500 focus:border-purple-400 focus:outline-none"
                            />
                          </div>

                          <div className="sm:col-span-7">
                            <input
                              type="text"
                              placeholder="Título do Álbum"
                              value={entry.albumTitle}
                              onChange={(e) =>
                                handleUpdateCdEntry(
                                  idx,
                                  'albumTitle',
                                  e.target.value
                                )
                              }
                              onBlur={() => {
                                if (
                                  entry.albumTitle.trim() &&
                                  !entry.coverUrl
                                ) {
                                  handleFetchOrCycleCoverForIndex(idx, false);
                                }
                              }}
                              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-2 text-base sm:text-xs text-white placeholder-slate-500 focus:border-purple-400 focus:outline-none"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Nº Discos + Preço Individual + Botão Capa + Excluir */}
                      <div className="flex items-center justify-end gap-1.5 sm:shrink-0 pl-13 sm:pl-0">
                        <div className="w-14" title="Nº de Discos físicos (1 = Simples, 2 = Duplo, 3+ = Box Set)">
                          <input
                            type="number"
                            min="1"
                            max="50"
                            value={entry.discCount || 1}
                            onChange={(e) =>
                              handleUpdateCdEntry(
                                idx,
                                'discCount',
                                e.target.value
                              )
                            }
                            aria-label="Número de discos"
                            className="w-full rounded-lg bg-slate-900 border border-slate-700 px-1.5 py-2 text-base sm:text-xs text-indigo-300 font-mono text-center focus:border-purple-400 focus:outline-none"
                          />
                        </div>

                        <div className="relative flex-1 sm:flex-initial sm:w-24">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-400">
                            {currSymbol}
                          </span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder={
                              !hasIndividualPrices && parsedBundleVal > 0
                                ? unitOriginalPreview.toFixed(2)
                                : 'Preço'
                            }
                            value={entry.unitPrice}
                            onChange={(e) =>
                              handleUpdateCdEntry(
                                idx,
                                'unitPrice',
                                e.target.value
                              )
                            }
                            title="Preço pago neste CD específico"
                            className="w-full rounded-lg bg-slate-900 border border-slate-700 pl-5 pr-2 py-2 text-base sm:text-xs text-white font-mono placeholder-slate-500 focus:border-purple-400 focus:outline-none text-right"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            handleFetchOrCycleCoverForIndex(idx, true)
                          }
                          disabled={entry.isFetchingCover}
                          title={
                            totalCands > 1
                              ? `Trocar capa (${currentCandNum}/${totalCands})`
                              : 'Buscar / Trocar capa na internet'
                          }
                          className="inline-flex items-center justify-center gap-1 px-2.5 py-2 rounded-lg bg-purple-500/15 hover:bg-purple-500/30 border border-purple-500/30 text-purple-300 transition shrink-0 text-xs font-mono"
                        >
                          {totalCands > 1 ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5" />
                              <span>
                                {currentCandNum}/{totalCands}
                              </span>
                            </>
                          ) : (
                            <Sparkles className="w-4 h-4" />
                          )}
                        </button>

                        {cdEntries.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveCdEntryRow(idx)}
                            title="Remover este CD"
                            className="p-2 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-900 transition shrink-0"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {parsedBundleVal > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-950/80 border border-purple-500/30 px-3.5 py-2.5 text-xs">
                  <span className="text-slate-300">
                    {hasIndividualPrices ? (
                      <>
                        Soma de <strong>{parsedBundleQty} CDs</strong>:{' '}
                        <strong className="font-mono text-purple-300">
                          {formatOriginalCurrency(parsedBundleVal, currency)}
                        </strong>
                      </>
                    ) : (
                      <>
                        <strong>{parsedBundleQty}</strong>{' '}
                        {parsedBundleQty === 1 ? 'CD' : 'CDs'} de{' '}
                        <strong className="font-mono text-purple-300">
                          {formatOriginalCurrency(
                            unitOriginalPreview,
                            currency
                          )}
                        </strong>{' '}
                        cada
                      </>
                    )}
                  </span>
                  <span className="font-mono text-emerald-400 font-semibold">
                    Subtotal CDs: ≈ {formatBrl(parsedBundleVal * parsedRate)}
                  </span>
                </div>
              )}
            </div>

            {/* =====================================================================
                BLOCO 2: AGRUPAMENTO DE PACOTES ÚNICOS DISPONÍVEIS PARA CONSOLIDAR
                (Com suporte a Descarte / Exclusão de CDs para reduzir peso!)
                ===================================================================== */}
            {eligibleForwarderPackages.length > 0 && !showForwarderBox && (
              <div className="rounded-xl bg-slate-950/70 border border-slate-800 px-4 py-2.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-slate-400 min-w-0">
                  <PackageOpen className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="truncate">
                    Há{' '}
                    <strong className="text-amber-300">
                      {eligibleForwarderPackages.length}{' '}
                      {eligibleForwarderPackages.length === 1
                        ? 'pacote único disponível'
                        : 'pacotes únicos disponíveis'}
                    </strong>{' '}
                    para consolidar
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsForwarderExpandedManual(true)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-amber-300 hover:text-amber-200 shrink-0"
                >
                  <span>Incluir neste pacote</span>
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
            )}

            {showForwarderBox && (
              <div className="rounded-xl bg-amber-950/20 border border-amber-500/40 p-4 space-y-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                      <PackageOpen className="w-4 h-4 text-amber-400" />
                      Consolidar Pacotes Únicos / Compras Avulsas (
                      {eligibleForwarderPackages.length} disponíveis)
                    </span>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Selecione os CDs para incluir na caixa ou clique na{' '}
                      <strong className="text-rose-300">lixeira (🗑️)</strong>{' '}
                      para descartar um CD no redirecionador (redistribuindo seu
                      custo entre os CDs mantidos).
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSelectAllForwarderPackages}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-amber-500/40 px-2.5 py-1.5 text-xs font-medium text-amber-300 transition"
                    >
                      {areAllForwarderSelected ? (
                        <>
                          <CheckSquare className="w-3.5 h-3.5" /> Desmarcar
                          Todos
                        </>
                      ) : (
                        <>
                          <Square className="w-3.5 h-3.5" /> Selecionar Todos (
                          {allForwarderCdIds.length} CDs)
                        </>
                      )}
                    </button>

                    {isAlreadyShippedStatus &&
                      selectedExistingCdIds.size === 0 &&
                      discardedExistingCdIds.size === 0 && (
                        <button
                          type="button"
                          onClick={() => setIsForwarderExpandedManual(false)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                          title="Recolher seção"
                        >
                          <ChevronUp className="w-4 h-4" />
                        </button>
                      )}
                  </div>
                </div>

                {/* Lista de Pacotes Elegíveis */}
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {eligibleForwarderPackages.map((fp) => {
                    const nonDiscardedInPkg = fp.items.filter(
                      (cd) => !discardedExistingCdIds.has(cd.id)
                    );
                    const discardedInPkgCount =
                      fp.items.length - nonDiscardedInPkg.length;
                    const selectedInPkg = nonDiscardedInPkg.filter((cd) =>
                      selectedExistingCdIds.has(cd.id)
                    ).length;
                    const isWholePkgSelected =
                      selectedInPkg === nonDiscardedInPkg.length &&
                      nonDiscardedInPkg.length > 0;
                    const isPartiallySelected =
                      selectedInPkg > 0 &&
                      selectedInPkg < nonDiscardedInPkg.length;

                    const pkgCdsSum = fp.items.reduce(
                      (acc, cd) => acc + (Number(cd.unitOriginalValue) || 0),
                      0
                    );
                    const effectiveUnitAfterDiscard =
                      nonDiscardedInPkg.length > 0
                        ? pkgCdsSum / nonDiscardedInPkg.length
                        : 0;

                    return (
                      <div
                        key={fp.shipment.id}
                        className={`rounded-lg border p-3 transition ${
                          isWholePkgSelected || isPartiallySelected
                            ? 'bg-slate-950/90 border-amber-500/60'
                            : 'bg-slate-950/50 border-slate-800'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              handleToggleWholeForwarderPackage(fp)
                            }
                            className="flex items-center gap-2 text-left"
                          >
                            {isWholePkgSelected ? (
                              <CheckSquare className="w-4 h-4 text-amber-400 shrink-0" />
                            ) : isPartiallySelected ? (
                              <CheckSquare className="w-4 h-4 text-indigo-400 shrink-0" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-500 shrink-0" />
                            )}
                            <span className="text-xs font-bold text-white">
                              {fp.shipment.name}
                            </span>
                            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-slate-300">
                              {nonDiscardedInPkg.length}/{fp.items.length} CDs
                            </span>
                            {discardedInPkgCount > 0 && (
                              <span className="rounded bg-rose-500/20 border border-rose-500/40 px-1.5 py-0.5 text-[10px] font-mono text-rose-300">
                                {discardedInPkgCount} descartado(s)
                              </span>
                            )}
                          </button>

                          <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400">
                            <span>
                              Total Lote:{' '}
                              {formatOriginalCurrency(
                                pkgCdsSum,
                                fp.shipment.currency
                              )}
                            </span>
                            {fp.shipment.internalShipping > 0 && (
                              <span>
                                • Frete Local:{' '}
                                {formatOriginalCurrency(
                                  fp.shipment.internalShipping,
                                  fp.shipment.currency
                                )}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="mt-2 pl-6 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {fp.items.map((cd) => {
                            const isCdChecked = selectedExistingCdIds.has(
                              cd.id
                            );
                            const isCdDiscarded = discardedExistingCdIds.has(
                              cd.id
                            );
                            const displayPrice =
                              discardedInPkgCount > 0 && !isCdDiscarded
                                ? effectiveUnitAfterDiscard
                                : cd.unitOriginalValue;

                            return (
                              <div
                                key={cd.id}
                                className={`flex items-center justify-between gap-1.5 rounded px-2.5 py-1.5 text-xs border transition ${
                                  isCdDiscarded
                                    ? 'bg-rose-950/35 border-rose-500/40 text-rose-300/80'
                                    : isCdChecked
                                    ? 'bg-amber-500/15 border-amber-500/40 text-white'
                                    : 'bg-slate-900/70 border-slate-800 text-slate-400 hover:text-slate-200'
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleToggleSingleForwarderCd(cd.id)
                                  }
                                  className="flex items-center justify-between gap-2 flex-1 min-w-0 text-left"
                                >
                                  <span
                                    className={`truncate ${
                                      isCdDiscarded ? 'line-through' : ''
                                    }`}
                                  >
                                    {isCdChecked ? '✓ ' : ''}
                                    <strong>{cd.artist}</strong> —{' '}
                                    {cd.albumTitle}
                                  </span>
                                  <span className="font-mono text-[11px] text-slate-300 shrink-0">
                                    {isCdDiscarded
                                      ? 'Descartado'
                                      : formatOriginalCurrency(
                                          displayPrice,
                                          fp.shipment.currency
                                        )}
                                  </span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() =>
                                    handleToggleDiscardForwarderCd(cd.id)
                                  }
                                  title={
                                    isCdDiscarded
                                      ? 'Restaurar CD (cancelar descarte)'
                                      : 'Descartar/Excluir este CD no redirecionador (redistribui o valor entre os demais CDs do lote)'
                                  }
                                  className={`p-1 rounded transition shrink-0 ${
                                    isCdDiscarded
                                      ? 'bg-rose-500/25 text-rose-200 hover:bg-rose-500/40'
                                      : 'text-slate-500 hover:text-rose-400 hover:bg-slate-800'
                                  }`}
                                >
                                  {isCdDiscarded ? (
                                    <RotateCcw className="w-3.5 h-3.5" />
                                  ) : (
                                    <Trash2 className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {discardedExistingCdIds.size > 0 && (
                  <div className="rounded-lg bg-rose-950/35 border border-rose-500/40 px-3 py-2 text-[11px] text-rose-200 flex items-center gap-2">
                    <Trash2 className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>
                      <strong>
                        {discardedExistingCdIds.size}{' '}
                        {discardedExistingCdIds.size === 1
                          ? 'CD marcado'
                          : 'CDs marcados'}{' '}
                        para descarte:
                      </strong>{' '}
                      serão excluídos ao salvar e seu valor pago + frete local
                      serão redistribuídos automaticamente entre os CDs mantidos
                      do mesmo lote.
                    </span>
                  </div>
                )}

                {selectedExistingCdIds.size > 0 && (
                  <div className="pt-2 border-t border-amber-500/30 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-amber-200">
                        Modo de consolidação no redirecionador (
                        {selectedExistingCdIds.size}{' '}
                        {selectedExistingCdIds.size === 1
                          ? 'CD selecionado'
                          : 'CDs selecionados'}{' '}
                        de {selectedSourceShipmentsCount}{' '}
                        {selectedSourceShipmentsCount === 1
                          ? 'pacote'
                          : 'pacotes'}
                        ):
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div
                        onClick={() => {
                          setConsolidationAction('group_only');
                          setForwarderFee(groupOnlyFeePreset);
                        }}
                        className={`cursor-pointer rounded-xl border p-3 transition flex items-center justify-between gap-2 ${
                          consolidationAction === 'group_only'
                            ? 'bg-indigo-950/60 border-indigo-400 text-white'
                            : 'bg-slate-950/70 border-slate-800 text-slate-400'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-bold flex items-center gap-1.5 text-white">
                            <PackageCheck className="w-4 h-4 text-indigo-400 shrink-0" />
                            <span>Apenas Agrupar</span>
                          </div>
                          <p className="text-[11px] text-slate-400">
                            Mantém embalagens originais
                          </p>
                        </div>
                        <div
                          className="flex items-center gap-1 shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="text-xs font-mono text-indigo-300">
                            {currSymbol}
                          </span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={groupOnlyFeePreset}
                            onChange={(e) => {
                              setGroupOnlyFeePreset(e.target.value);
                              setConsolidationAction('group_only');
                              setForwarderFee(e.target.value);
                            }}
                            className="w-16 rounded-lg bg-slate-900 border border-slate-700 px-2 py-1 text-xs font-mono text-white text-right"
                          />
                        </div>
                      </div>

                      <div
                        onClick={() => {
                          setConsolidationAction('unpack_and_repack');
                          setForwarderFee(unpackAndRepackFeePreset);
                        }}
                        className={`cursor-pointer rounded-xl border p-3 transition flex items-center justify-between gap-2 ${
                          consolidationAction === 'unpack_and_repack'
                            ? 'bg-amber-950/60 border-amber-400 text-white'
                            : 'bg-slate-950/70 border-slate-800 text-slate-400'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-bold flex items-center gap-1.5 text-white">
                            <PackageOpen className="w-4 h-4 text-amber-400 shrink-0" />
                            <span>Desempacotar + Agrupar</span>
                          </div>
                          <p className="text-[11px] text-slate-400">
                            Tira das caixas individuais
                          </p>
                        </div>
                        <div
                          className="flex items-center gap-1 shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="text-xs font-mono text-amber-300">
                            {currSymbol}
                          </span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={unpackAndRepackFeePreset}
                            onChange={(e) => {
                              setUnpackAndRepackFeePreset(e.target.value);
                              setConsolidationAction('unpack_and_repack');
                              setForwarderFee(e.target.value);
                            }}
                            className="w-16 rounded-lg bg-slate-900 border border-slate-700 px-2 py-1 text-xs font-mono text-white text-right"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

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
