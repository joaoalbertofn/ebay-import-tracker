'use client';

import React, { useEffect, useState } from 'react';
import { CDItem, CurrencyCode } from '@/types/tracker';
import {
  CURRENCY_META,
  formatBrl,
  formatOriginalCurrency,
} from '@/lib/calculations';
import {
  AlbumCoverCandidate,
  fetchBestAlbumCover,
  resolveCoverCycleOrFetch,
  searchAlbumCoverCandidates,
} from '@/lib/coverArt';
import { useEbayQuickPaste } from '@/hooks/useEbayQuickPaste';
import {
  extractEbayListingUrls,
  extractEbayOrderInfo,
} from '@/lib/ebayImport';
import { AlbumCover } from '@/components/AlbumCover';
import {
  X,
  Disc3,
  Layers,
  Calculator,
  Truck,
  Plus,
  Trash2,
  Image as ImageIcon,
  Sparkles,
  Loader2,
  Check,
  RefreshCw,
  ExternalLink,
  Link2,
} from 'lucide-react';

interface CDModalProps {
  isOpen: boolean;
  onClose: () => void;
  shipmentId: string;
  currency: CurrencyCode;
  exchangeRate: number;
  editingItem?: CDItem | null;
  existingBundles: {
    bundleId: string;
    bundleName: string;
    bundleTotalValue: number;
    bundleTotalQuantity: number;
    bundleInternalShipping: number;
    localTrackingCode: string;
  }[];
  onSaveItems: (
    items: Omit<CDItem, 'id' | 'createdAt'>[],
    editingId?: string,
    syncBundleSiblings?: boolean
  ) => void;
}

interface BatchAlbumEntry {
  artist: string;
  albumTitle: string;
  discCount: number;
  coverUrl?: string;
  releaseYear?: string;
  ebayListingUrl?: string;
  isFetchingCover?: boolean;
  coverCandidates?: AlbumCoverCandidate[];
  coverCandidateIndex?: number;
}

export function CDModal({
  isOpen,
  onClose,
  shipmentId,
  currency: parentCurrency,
  exchangeRate: parentExchangeRate,
  editingItem,
  existingBundles,
  onSaveItems,
}: CDModalProps) {
  const [artist, setArtist] = useState('');
  const [albumTitle, setAlbumTitle] = useState('');
  const [discCount, setDiscCount] = useState<string>('1');
  const [isBundle, setIsBundle] = useState(false);

  // Capa do CD e Ano de Lançamento (Modo Individual)
  const [coverUrl, setCoverUrl] = useState('');
  const [releaseYear, setReleaseYear] = useState('');
  const [coverCandidates, setCoverCandidates] = useState<AlbumCoverCandidate[]>(
    []
  );
  const [isSearchingCover, setIsSearchingCover] = useState(false);
  const [coverSearchMessage, setCoverSearchMessage] = useState('');

  // Campos de Bundle
  const [bundleName, setBundleName] = useState('');
  const [bundleId, setBundleId] = useState('');
  const [bundleTotalValue, setBundleTotalValue] = useState<string>('');
  const [bundleTotalQuantity, setBundleTotalQuantity] = useState<string>('2');
  const [syncBundleSiblings, setSyncBundleSiblings] = useState(true);

  // Modo de criação múltipla (Batch) para quando comprou um bundle de vários CDs
  const [enableBatchCreate, setEnableBatchCreate] = useState(false);
  const [batchEntries, setBatchEntries] = useState<BatchAlbumEntry[]>([
    { artist: '', albumTitle: '', discCount: 1 },
    { artist: '', albumTitle: '', discCount: 1 },
  ]);

  // Campo de Valor Unitário Direto (quando não é bundle)
  const [directUnitValue, setDirectUnitValue] = useState<string>('');

  // Frete local, Rastreio local e Links eBay
  const [bundleInternalShipping, setBundleInternalShipping] =
    useState<string>('0');
  const [localTrackingCode, setLocalTrackingCode] = useState('');
  const [ebayListingUrl, setEbayListingUrl] = useState('');
  const [ebayOrderInput, setEbayOrderInput] = useState('');
  const [ebayQuickPasteInput, setEbayQuickPasteInput] = useState('');
  const {
    isParsingEbay,
    ebayImportFeedback,
    setEbayImportFeedback,
    parseEbay,
  } = useEbayQuickPaste();

  useEffect(() => {
    if (!isOpen) return;

    setCoverCandidates([]);
    setCoverSearchMessage('');
    setEbayQuickPasteInput('');
    setEbayImportFeedback(null);

    if (editingItem) {
      setArtist(editingItem.artist);
      setAlbumTitle(editingItem.albumTitle);
      setDiscCount(String(editingItem.discCount || 1));
      setIsBundle(editingItem.isBundle);
      setCoverUrl(editingItem.coverUrl || '');
      setReleaseYear(editingItem.releaseYear || '');
      setBundleId(editingItem.bundleId || `bundle-${Date.now()}`);
      setBundleName(editingItem.bundleName || '');
      setBundleTotalValue(
        editingItem.bundleTotalValue !== undefined
          ? String(editingItem.bundleTotalValue)
          : String(editingItem.unitOriginalValue)
      );
      setBundleTotalQuantity(
        editingItem.bundleTotalQuantity !== undefined
          ? String(editingItem.bundleTotalQuantity)
          : '1'
      );
      setDirectUnitValue(String(editingItem.unitOriginalValue));
      setBundleInternalShipping(
        String(editingItem.bundleInternalShipping || 0)
      );
      setLocalTrackingCode(editingItem.localTrackingCode || '');
      setEbayListingUrl(editingItem.ebayListingUrl || '');
      setEbayOrderInput(
        editingItem.ebayOrderUrl || editingItem.ebayOrderId || ''
      );
      setEnableBatchCreate(false);
      setSyncBundleSiblings(true);
    } else {
      setArtist('');
      setAlbumTitle('');
      setDiscCount('1');
      setIsBundle(false);
      setCoverUrl('');
      setReleaseYear('');
      setBundleId(`bundle-${Date.now()}`);
      setBundleName('');
      setBundleTotalValue('');
      setBundleTotalQuantity('2');
      setDirectUnitValue('');
      setBundleInternalShipping('0');
      setLocalTrackingCode('');
      setEbayListingUrl('');
      setEbayOrderInput('');
      setEnableBatchCreate(false);
      setBatchEntries([
        { artist: '', albumTitle: '', discCount: 1 },
        { artist: '', albumTitle: '', discCount: 1 },
      ]);
    }
  }, [isOpen, editingItem, setEbayImportFeedback]);

  if (!isOpen) return null;

  const activeCurrency: CurrencyCode = parentCurrency;
  const activeExchangeRate = parentExchangeRate;
  const currSymbol = CURRENCY_META[activeCurrency].symbol;

  const parsedBundleTotal = parseFloat(bundleTotalValue) || 0;
  const parsedBundleQty = Math.max(
    1,
    enableBatchCreate && !editingItem
      ? batchEntries.length
      : parseInt(bundleTotalQuantity, 10) || 1
  );
  const calculatedBundleUnitValue = isBundle
    ? parsedBundleTotal / parsedBundleQty
    : parseFloat(directUnitValue) || 0;

  const parsedLocalShipping = Math.max(
    0,
    parseFloat(bundleInternalShipping) || 0
  );
  const dilutedUnitShipping = isBundle
    ? parsedLocalShipping / parsedBundleQty
    : parsedLocalShipping;

  const handleSearchCover = async () => {
    if (!artist.trim() && !albumTitle.trim()) {
      setCoverSearchMessage('Digite o Artista e o Nome do Álbum primeiro.');
      return;
    }
    setIsSearchingCover(true);
    setCoverSearchMessage('');
    try {
      const results = await searchAlbumCoverCandidates(artist, albumTitle);
      setCoverCandidates(results);
      if (results.length > 0) {
        setCoverUrl(results[0].coverUrl);
        if (results[0].releaseYear) setReleaseYear(results[0].releaseYear);
        if (albumTitle.startsWith('CD #') && results[0].albumTitle) {
          setAlbumTitle(results[0].albumTitle);
        }
      } else {
        setCoverSearchMessage(
          'Nenhuma capa encontrada automaticamente. Tente ajustar o nome do álbum ou cole um link.'
        );
      }
    } finally {
      setIsSearchingCover(false);
    }
  };

  // Busca ou alterna a capa em uma linha específica do modo Lote (Batch)
  const handleFetchOrCycleBatchCover = async (
    index: number,
    cycleNext: boolean = false
  ) => {
    const target = batchEntries[index];
    if (!target) return;

    const isCachedCycle =
      cycleNext &&
      target.coverCandidates &&
      target.coverCandidates.length > 1;

    if (!isCachedCycle) {
      if (!(target.artist.trim() || artist.trim()) && !target.albumTitle.trim())
        return;
      setBatchEntries((prev) =>
        prev.map((entry, idx) =>
          idx === index ? { ...entry, isFetchingCover: true } : entry
        )
      );
    }

    try {
      const { patch } = await resolveCoverCycleOrFetch(
        target,
        cycleNext,
        artist
      );
      setBatchEntries((prev) =>
        prev.map((entry, idx) =>
          idx === index
            ? { ...entry, ...(patch || {}), isFetchingCover: false }
            : entry
        )
      );
    } catch {
      setBatchEntries((prev) =>
        prev.map((entry, idx) =>
          idx === index ? { ...entry, isFetchingCover: false } : entry
        )
      );
    }
  };

  const handleSelectExistingBundle = (selectedId: string) => {
    if (!selectedId) {
      setBundleId(`bundle-${Date.now()}`);
      return;
    }
    const found = existingBundles.find((b) => b.bundleId === selectedId);
    if (found) {
      setBundleId(found.bundleId);
      setBundleName(found.bundleName);
      setBundleTotalValue(String(found.bundleTotalValue));
      setBundleTotalQuantity(String(found.bundleTotalQuantity));
      setBundleInternalShipping(String(found.bundleInternalShipping));
      setLocalTrackingCode(found.localTrackingCode);
      setEnableBatchCreate(false);
    }
  };

  const handleSwitchMode = (bundleMode: boolean) => {
    setIsBundle(bundleMode);
    if (bundleMode && !editingItem) {
      setEnableBatchCreate(true);
      const targetCount = Math.min(
        20,
        Math.max(2, parseInt(bundleTotalQuantity, 10) || 2)
      );
      const nextEntries: BatchAlbumEntry[] = [];
      for (let i = 0; i < targetCount; i++) {
        nextEntries.push(
          batchEntries[i] || {
            artist: artist || '',
            albumTitle: '',
            discCount: 1,
          }
        );
      }
      setBatchEntries(nextEntries);
    } else {
      setEnableBatchCreate(false);
    }
  };

  const handleBundleQuantityChange = (val: string) => {
    setBundleTotalQuantity(val);
    const num = parseInt(val, 10);
    if (enableBatchCreate && num >= 1 && num <= 25) {
      const nextEntries: BatchAlbumEntry[] = [];
      for (let i = 0; i < num; i++) {
        nextEntries.push(
          batchEntries[i] || {
            artist: batchEntries[0]?.artist || artist || '',
            albumTitle: '',
            discCount: 1,
          }
        );
      }
      setBatchEntries(nextEntries);
    }
  };

  const handleImportFromEbayInCDModal = async () => {
    const data = await parseEbay(ebayQuickPasteInput);
    if (!data) return;

    if (data.ebayOrderUrl || data.ebayOrderId) {
      setEbayOrderInput(data.ebayOrderUrl || data.ebayOrderId || '');
    }

    if (data.internalShipping !== undefined && data.internalShipping >= 0) {
      setBundleInternalShipping(String(Number(data.internalShipping.toFixed(2))));
    }

    if (data.localTrackingCode) {
      setLocalTrackingCode(data.localTrackingCode.toUpperCase());
    }

    if (data.items && data.items.length === 1) {
      const item = data.items[0];
      if (!editingItem) setIsBundle(false);
      setArtist(item.artist || '');
      setAlbumTitle(item.albumTitle || item.rawTitle || '');
      setDiscCount(String(item.discCount || 1));
      if (item.unitPrice !== undefined && item.unitPrice >= 0) {
        setDirectUnitValue(String(Number(item.unitPrice.toFixed(2))));
      }
      if (item.releaseYear) setReleaseYear(item.releaseYear);
      if (item.coverUrl) setCoverUrl(item.coverUrl);
      if (item.ebayListingUrl) setEbayListingUrl(item.ebayListingUrl);

      // Busca capa oficial no iTunes/MusicBrainz
      if (item.artist || item.albumTitle) {
        searchAlbumCoverCandidates(item.artist, item.albumTitle)
          .then((cands) => {
            if (cands.length > 0) {
              setCoverCandidates(cands);
              setCoverUrl(cands[0].coverUrl);
              if (cands[0].releaseYear) setReleaseYear(cands[0].releaseYear);
            }
          })
          .catch(() => {});
      }

      setEbayQuickPasteInput('');
      setEbayImportFeedback({
        type: 'success',
        text: `CD "${item.artist ? `${item.artist} - ` : ''}${item.albumTitle}" preenchido automaticamente!`,
      });
    } else if (data.items && data.items.length > 1 && !editingItem) {
      setIsBundle(true);
      setEnableBatchCreate(true);
      setBundleTotalQuantity(String(data.items.length));
      if (data.bundleTotalValue !== undefined && data.bundleTotalValue > 0) {
        setBundleTotalValue(String(Number(data.bundleTotalValue.toFixed(2))));
      } else {
        const sumPrices = data.items.reduce(
          (acc, i) => acc + (i.unitPrice || 0),
          0
        );
        if (sumPrices > 0) {
          setBundleTotalValue(String(Number(sumPrices.toFixed(2))));
        }
      }
      const entries: BatchAlbumEntry[] = data.items.map((item) => ({
        artist: item.artist || '',
        albumTitle: item.albumTitle || item.rawTitle || '',
        discCount: item.discCount || 1,
        coverUrl: item.coverUrl,
        releaseYear: item.releaseYear,
        ebayListingUrl: item.ebayListingUrl,
      }));
      setBatchEntries(entries);

      entries.forEach((entry, idx) => {
        if (entry.artist || entry.albumTitle) {
          fetchBestAlbumCover(entry.artist, entry.albumTitle)
            .then((best) => {
              if (best?.coverUrl) {
                setBatchEntries((curr) =>
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
            .catch(() => {});
        }
      });

      setEbayQuickPasteInput('');
      setEbayImportFeedback({
        type: 'success',
        text: `${entries.length} CDs importados em modo Lote/Bundle!`,
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
        text: `Pedido #${data.ebayOrderId} vinculado!`,
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const finalUnitOriginalValue = Number(calculatedBundleUnitValue.toFixed(4));
    const localShippingNum = Math.max(
      0,
      parseFloat(bundleInternalShipping) || 0
    );
    const unitInternalShippingNum = isBundle
      ? Number((localShippingNum / parsedBundleQty).toFixed(4))
      : localShippingNum;

    const resolvedOrderInfo = extractEbayOrderInfo(ebayOrderInput);
    const finalOrderId = resolvedOrderInfo.ebayOrderId || undefined;
    const finalOrderUrl =
      resolvedOrderInfo.ebayOrderUrl ||
      (ebayOrderInput.trim().startsWith('http') &&
      !extractEbayListingUrls(ebayOrderInput).length
        ? ebayOrderInput.trim()
        : undefined);
    const finalListingUrl =
      ebayListingUrl.trim() ||
      extractEbayListingUrls(ebayOrderInput)[0] ||
      undefined;

    if (isBundle && enableBatchCreate && !editingItem) {
      const validEntries = batchEntries.filter(
        (entry) => entry.artist.trim() || entry.albumTitle.trim()
      );
      if (validEntries.length === 0) return;

      const effectiveQty = validEntries.length;
      const batchUnitVal = Number(
        (parsedBundleTotal / effectiveQty).toFixed(4)
      );
      const batchUnitShip = Number(
        (localShippingNum / effectiveQty).toFixed(4)
      );

      const itemsToCreate: Omit<CDItem, 'id' | 'createdAt'>[] =
        validEntries.map((entry, idx) => ({
          shipmentId,
          currency: activeCurrency,
          artist:
            entry.artist.trim() || artist.trim() || 'Artista Desconhecido',
          albumTitle: entry.albumTitle.trim() || `CD #${idx + 1} do Bundle`,
          discCount: Math.max(1, Number(entry.discCount) || 1),
          isBundle: true,
          bundleId: bundleId || `bundle-${Date.now()}`,
          bundleName: bundleName.trim() || `Bundle (${effectiveQty} CDs)`,
          bundleTotalValue: parsedBundleTotal,
          bundleTotalQuantity: effectiveQty,
          bundleInternalShipping: localShippingNum,
          unitInternalShipping: batchUnitShip,
          localTrackingCode: localTrackingCode.trim().toUpperCase(),
          ebayOrderId: finalOrderId,
          ebayOrderUrl: finalOrderUrl,
          ebayListingUrl: entry.ebayListingUrl || finalListingUrl,
          unitOriginalValue: batchUnitVal,
          coverUrl: entry.coverUrl,
          releaseYear: entry.releaseYear,
        }));

      onSaveItems(itemsToCreate);
      onClose();
      return;
    }

    if (!artist.trim() || !albumTitle.trim()) return;

    const singleItem: Omit<CDItem, 'id' | 'createdAt'> = {
      shipmentId,
      currency: activeCurrency,
      artist: artist.trim(),
      albumTitle: albumTitle.trim(),
      discCount: Math.max(1, parseInt(discCount, 10) || 1),
      isBundle,
      bundleId: isBundle ? bundleId || `bundle-${Date.now()}` : undefined,
      bundleName: isBundle
        ? bundleName.trim() || `Bundle (${parsedBundleQty} CDs)`
        : undefined,
      bundleTotalValue: isBundle ? parsedBundleTotal : undefined,
      bundleTotalQuantity: isBundle ? parsedBundleQty : undefined,
      bundleInternalShipping: localShippingNum,
      unitInternalShipping: unitInternalShippingNum,
      localTrackingCode: localTrackingCode.trim().toUpperCase(),
      ebayOrderId: finalOrderId,
      ebayOrderUrl: finalOrderUrl,
      ebayListingUrl: finalListingUrl,
      unitOriginalValue: finalUnitOriginalValue,
      coverUrl: coverUrl.trim() || undefined,
      releaseYear: releaseYear.trim() || undefined,
    };

    onSaveItems(
      [singleItem],
      editingItem?.id,
      Boolean(editingItem && isBundle && syncBundleSiblings)
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4">
      <div className="relative w-full max-w-2xl max-h-[94dvh] sm:max-h-[90vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-slate-900 border-t sm:border border-slate-700/80 shadow-2xl overflow-hidden">
        {/* Header Fixo */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 bg-slate-800/80 border-b border-slate-700/70 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-xl bg-purple-500/20 text-purple-400 shrink-0">
              <Disc3 className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-semibold text-white truncate">
                {editingItem
                  ? 'Editar CD & Capa do Álbum'
                  : 'Adicionar CD ou Lote ao Pacote'}
              </h2>
              <p className="text-xs text-slate-400 truncate">
                Câmbio do pacote: <strong>1 {activeCurrency}</strong> ≈ R${' '}
                {activeExchangeRate.toFixed(2)} (Cotação Automática)
              </p>
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
          <div className="p-4 sm:p-6 space-y-5 overflow-y-auto flex-1">
            {/* ⚡ Preenchimento Rápido do eBay */}
            <div className="rounded-xl bg-slate-950/85 border border-indigo-500/35 p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-indigo-300 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                  ⚡ Importar Rápido do eBay
                </span>
                <span className="text-[10px] text-slate-400">
                  Cole link do anúncio (<code className="text-indigo-300">ebay.../itm/...</code>) ou texto do pedido
                </span>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <textarea
                  rows={1}
                  placeholder="Cole aqui o link do anúncio (ebay.co.uk/itm/...), link do pedido ou texto copiado..."
                  value={ebayQuickPasteInput}
                  onChange={(e) => setEbayQuickPasteInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleImportFromEbayInCDModal();
                    }
                  }}
                  className="flex-1 rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-indigo-400 focus:outline-none resize-y min-h-[38px]"
                />
                <button
                  type="button"
                  onClick={handleImportFromEbayInCDModal}
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

            {/* SELETOR EM ABAS (Segmented Control): CD Individual vs Lote / Bundle */}
            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-950 border border-slate-800">
              <button
                type="button"
                onClick={() => handleSwitchMode(false)}
                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-semibold transition ${
                  !isBundle
                    ? 'bg-purple-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Disc3 className="w-4 h-4 shrink-0" />
                <span>CD Individual / Box</span>
              </button>

              <button
                type="button"
                onClick={() => handleSwitchMode(true)}
                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-semibold transition ${
                  isBundle
                    ? 'bg-purple-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Layers className="w-4 h-4 shrink-0" />
                <span>Lote / Bundle (2+ CDs)</span>
              </button>
            </div>

            {/* Se NÃO estiver no modo Batch de vários álbuns, exibe os campos normais de Artista / Álbum / Nº Discos + Busca de Capa */}
            {(!isBundle || !enableBatchCreate || editingItem) && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5">
                  <div className="sm:col-span-5">
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Artista / Banda *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Ex: HIM"
                      value={artist}
                      onChange={(e) => setArtist(e.target.value)}
                      className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3.5 py-2.5 text-base sm:text-sm text-white placeholder-slate-500 focus:border-purple-500 focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-5">
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Título do Álbum *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Ex: Razorblade Romance"
                      value={albumTitle}
                      onChange={(e) => setAlbumTitle(e.target.value)}
                      className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3.5 py-2.5 text-base sm:text-sm text-white placeholder-slate-500 focus:border-purple-500 focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label
                      className="block text-xs font-medium text-slate-300 mb-1.5"
                      title="Se for um CD Duplo ou Box Set, informe quantos discos físicos vêm nele"
                    >
                      Nº Discos
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={discCount}
                      onChange={(e) => setDiscCount(e.target.value)}
                      className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2.5 text-base sm:text-sm text-white font-mono text-center focus:border-purple-500 focus:outline-none"
                    />
                  </div>
                </div>

                {/* BUSCADOR DE CAPA DO ÁLBUM NA INTERNET */}
                <div className="rounded-xl bg-slate-800/40 border border-slate-700/70 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-indigo-300 flex items-center gap-1.5">
                      <ImageIcon className="w-4 h-4 text-indigo-400" /> Capa do
                      Álbum
                    </span>
                    <button
                      type="button"
                      onClick={handleSearchCover}
                      disabled={isSearchingCover}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white shadow transition disabled:opacity-50"
                    >
                      {isSearchingCover ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                      Buscar Capa Automaticamente
                    </button>
                  </div>

                  {coverSearchMessage && (
                    <p className="text-xs text-amber-300">
                      {coverSearchMessage}
                    </p>
                  )}

                  <div className="flex items-center gap-3.5">
                    <div className="h-16 w-16 sm:h-20 sm:w-20 rounded-xl bg-slate-950 border border-slate-700 flex items-center justify-center overflow-hidden shrink-0 shadow-md">
                      <AlbumCover
                        src={coverUrl}
                        alt={albumTitle}
                        iconClassName="w-8 h-8 text-slate-600"
                      />
                    </div>

                    <div className="flex-1 min-w-0 space-y-1.5">
                      <label className="block text-[11px] text-slate-400">
                        URL da Capa (automática na busca ou cole um link):
                      </label>
                      <input
                        type="url"
                        placeholder="https://..."
                        value={coverUrl}
                        onChange={(e) => setCoverUrl(e.target.value)}
                        className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-base sm:text-xs text-slate-200 placeholder-slate-600 focus:border-indigo-500 focus:outline-none"
                      />
                      {releaseYear && (
                        <div className="text-[11px] text-indigo-300">
                          Ano de lançamento: <strong>{releaseYear}</strong>
                        </div>
                      )}
                    </div>
                  </div>

                  {coverCandidates.length > 1 && (
                    <div className="pt-2 border-t border-slate-700/60 space-y-2">
                      <span className="text-[11px] text-slate-300 block">
                        Toque para escolher outra edição da capa:
                      </span>
                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                        {coverCandidates.map((cand, idx) => {
                          const isSelected = coverUrl === cand.coverUrl;
                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => {
                                setCoverUrl(cand.coverUrl);
                                if (cand.releaseYear) {
                                  setReleaseYear(cand.releaseYear);
                                }
                              }}
                              className={`group relative rounded-lg overflow-hidden border text-left transition ${
                                isSelected
                                  ? 'border-indigo-400 ring-2 ring-indigo-500/50'
                                  : 'border-slate-700 hover:border-slate-500'
                              }`}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={cand.coverUrl}
                                alt={cand.albumTitle}
                                className="w-full aspect-square object-cover"
                              />
                              {isSelected && (
                                <div className="absolute top-1 right-1 bg-indigo-600 rounded-full p-0.5 text-white shadow">
                                  <Check className="w-3 h-3" />
                                </div>
                              )}
                              <div className="p-1 bg-slate-950/90 text-[9px] text-slate-300 truncate">
                                {cand.releaseYear
                                  ? `${cand.releaseYear} · `
                                  : ''}
                                {cand.albumTitle}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Área Dinâmica: BUNDLE MARCADO vs INDIVIDUAL */}
            {isBundle ? (
              <div className="rounded-xl bg-purple-950/20 border border-purple-500/30 p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-purple-300 flex items-center gap-1.5">
                    <Calculator className="w-4 h-4" /> Dados do Lote / Bundle
                  </span>

                  {existingBundles.length > 0 && !editingItem && (
                    <select
                      onChange={(e) =>
                        handleSelectExistingBundle(e.target.value)
                      }
                      defaultValue=""
                      className="rounded-lg bg-slate-900 border border-purple-500/40 px-2.5 py-1.5 text-xs text-purple-200"
                    >
                      <option value="">+ Criar Novo Lote / Bundle</option>
                      {existingBundles.map((b) => (
                        <option key={b.bundleId} value={b.bundleId}>
                          Vincular a: {b.bundleName} ({currSymbol}{' '}
                          {b.bundleTotalValue})
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-12 gap-3.5">
                  <div className="col-span-2 sm:col-span-5">
                    <label className="block text-xs text-slate-300 mb-1">
                      Nome do Lote (Opcional)
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: Lote 4 CDs HIM"
                      value={bundleName}
                      onChange={(e) => setBundleName(e.target.value)}
                      className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-base sm:text-sm text-white placeholder-slate-500 focus:border-purple-500 focus:outline-none"
                    />
                  </div>

                  <div className="col-span-1 sm:col-span-4">
                    <label className="block text-xs text-slate-300 mb-1">
                      Valor Total ({currSymbol}) *
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono text-purple-300">
                        {currSymbol}
                      </span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        required
                        placeholder="12.00"
                        value={bundleTotalValue}
                        onChange={(e) => setBundleTotalValue(e.target.value)}
                        className="w-full rounded-xl bg-slate-950 border border-slate-700 pl-7 pr-3 py-2 text-base sm:text-sm text-white font-mono focus:border-purple-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="col-span-1 sm:col-span-3">
                    <label className="block text-xs text-slate-300 mb-1">
                      Qtd. CDs *
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="200"
                      required
                      value={
                        enableBatchCreate && !editingItem
                          ? batchEntries.length
                          : bundleTotalQuantity
                      }
                      onChange={(e) =>
                        handleBundleQuantityChange(e.target.value)
                      }
                      className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-base sm:text-sm text-white font-mono text-center focus:border-purple-500 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Lista de CDs do Bundle com Capa Automática */}
                {!editingItem && enableBatchCreate && (
                  <div className="space-y-2.5 pt-2 border-t border-purple-500/20">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-purple-200">
                        CDs deste Lote ({batchEntries.length}):
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setBatchEntries([
                            ...batchEntries,
                            {
                              artist: batchEntries[0]?.artist || '',
                              albumTitle: '',
                              discCount: 1,
                            },
                          ])
                        }
                        className="inline-flex items-center gap-1 rounded-lg bg-purple-600/30 hover:bg-purple-600/50 border border-purple-400/40 px-2.5 py-1 text-xs font-semibold text-purple-200 transition"
                      >
                        <Plus className="w-3.5 h-3.5" /> + Adicionar linha
                      </button>
                    </div>

                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                      {batchEntries.map((entry, index) => {
                        const totalCands = entry.coverCandidates?.length || 0;
                        const currentCandNum =
                          (entry.coverCandidateIndex ?? 0) + 1;

                        return (
                          <div
                            key={index}
                            className="flex items-center gap-2 rounded-xl bg-slate-950/90 border border-slate-800 p-2"
                          >
                            {/* Botão Miniatura da Capa */}
                            <button
                              type="button"
                              onClick={() =>
                                handleFetchOrCycleBatchCover(index, true)
                              }
                              title="Buscar ou trocar capa deste álbum"
                              className="relative h-10 w-10 rounded-lg bg-slate-900 border border-slate-700 flex items-center justify-center overflow-hidden shrink-0 hover:border-purple-400 transition"
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

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 flex-1 min-w-0">
                              <input
                                type="text"
                                placeholder="Artista / Banda"
                                value={entry.artist}
                                onChange={(e) => {
                                  const copy = [...batchEntries];
                                  copy[index] = {
                                    ...copy[index],
                                    artist: e.target.value,
                                    coverCandidates: undefined,
                                  };
                                  setBatchEntries(copy);
                                }}
                                onBlur={() => {
                                  if (
                                    entry.artist.trim() &&
                                    entry.albumTitle.trim() &&
                                    !entry.coverUrl
                                  ) {
                                    handleFetchOrCycleBatchCover(index, false);
                                  }
                                }}
                                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-base sm:text-xs text-white placeholder-slate-500 focus:border-purple-400 focus:outline-none"
                              />
                              <input
                                type="text"
                                placeholder="Título do Álbum"
                                value={entry.albumTitle}
                                onChange={(e) => {
                                  const copy = [...batchEntries];
                                  copy[index] = {
                                    ...copy[index],
                                    albumTitle: e.target.value,
                                    coverCandidates: undefined,
                                  };
                                  setBatchEntries(copy);
                                }}
                                onBlur={() => {
                                  if (
                                    entry.albumTitle.trim() &&
                                    !entry.coverUrl
                                  ) {
                                    handleFetchOrCycleBatchCover(index, false);
                                  }
                                }}
                                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-base sm:text-xs text-white placeholder-slate-500 focus:border-purple-400 focus:outline-none"
                              />
                            </div>

                            <button
                              type="button"
                              onClick={() =>
                                handleFetchOrCycleBatchCover(index, true)
                              }
                              disabled={entry.isFetchingCover}
                              className="inline-flex items-center gap-1 px-2 py-2 rounded-lg bg-purple-500/15 hover:bg-purple-500/30 border border-purple-500/30 text-purple-300 transition shrink-0 text-[10px] font-mono"
                              title="Buscar / Trocar capa"
                            >
                              {totalCands > 1 ? (
                                <>
                                  <RefreshCw className="w-3 h-3" />
                                  <span>
                                    {currentCandNum}/{totalCands}
                                  </span>
                                </>
                              ) : (
                                <Sparkles className="w-3.5 h-3.5" />
                              )}
                            </button>

                            {batchEntries.length > 1 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setBatchEntries(
                                    batchEntries.filter((_, i) => i !== index)
                                  )
                                }
                                className="p-1.5 text-slate-500 hover:text-rose-400 shrink-0"
                                title="Remover linha"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Resultado em tempo real da divisão do Bundle */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-950/80 border border-purple-500/20 px-3.5 py-2.5">
                  <div className="text-xs text-slate-300">
                    Valor por CD ({currSymbol} {parsedBundleTotal.toFixed(2)} ÷{' '}
                    {parsedBundleQty}):
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold font-mono text-purple-300">
                      {formatOriginalCurrency(
                        calculatedBundleUnitValue,
                        activeCurrency
                      )}{' '}
                      / CD
                    </span>
                    <span className="text-xs text-emerald-400 font-mono">
                      (≈{' '}
                      {formatBrl(
                        calculatedBundleUnitValue * activeExchangeRate
                      )}
                      )
                    </span>
                  </div>
                </div>

                {editingItem && editingItem.bundleId && (
                  <label className="flex items-center gap-2 text-xs text-purple-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={syncBundleSiblings}
                      onChange={(e) => setSyncBundleSiblings(e.target.checked)}
                      className="rounded border-slate-600 bg-slate-900 text-purple-500"
                    />
                    Sincronizar valor e frete com os outros CDs deste mesmo Lote
                  </label>
                )}
              </div>
            ) : (
              /* CD INDIVIDUAL: Exibe Valor do CD com Prefixo de Moeda */
              <div className="rounded-xl bg-slate-800/40 border border-slate-700/60 p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Valor Pago no CD / Box Set ({currSymbol}) *
                    </label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-mono text-purple-300">
                        {currSymbol}
                      </span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        required
                        placeholder="8.99"
                        value={directUnitValue}
                        onChange={(e) => setDirectUnitValue(e.target.value)}
                        className="w-full rounded-xl bg-slate-950 border border-slate-700 pl-8 pr-3.5 py-2.5 text-base sm:text-sm text-white font-mono focus:border-purple-500 focus:outline-none"
                      />
                    </div>
                  </div>
                  <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3">
                    <div className="text-[11px] text-slate-400">
                      Custo direto convertido (sem rateio):
                    </div>
                    <div className="text-base font-bold font-mono text-emerald-400 mt-0.5">
                      ≈{' '}
                      {formatBrl(
                        calculatedBundleUnitValue * activeExchangeRate
                      )}
                    </div>
                    {parseInt(discCount, 10) > 1 && (
                      <div className="text-[11px] text-purple-300 mt-0.5">
                        Box com {discCount} discos (
                        {formatOriginalCurrency(
                          calculatedBundleUnitValue / parseInt(discCount, 10),
                          activeCurrency
                        )}{' '}
                        / disco)
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Frete Local e Código de Rastreamento até o Redirecionador */}
            <div className="rounded-xl bg-slate-800/40 border border-slate-700/60 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
                  <Truck className="w-4 h-4" /> Envio Local (eBay →
                  Redirecionador)
                </span>
                <span className="text-[11px] text-slate-400">Opcional</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs text-slate-300 mb-1">
                    {isBundle
                      ? `Frete Local deste Lote`
                      : `Frete Local deste CD`}
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-400">
                      {currSymbol}
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={bundleInternalShipping}
                      onChange={(e) =>
                        setBundleInternalShipping(e.target.value)
                      }
                      className="w-full rounded-xl bg-slate-950 border border-slate-700 pl-7 pr-3 py-2 text-base sm:text-sm text-white font-mono focus:border-purple-500 focus:outline-none"
                    />
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">
                    {isBundle && parsedLocalShipping > 0
                      ? `Diluído em ${formatOriginalCurrency(
                          dilutedUnitShipping,
                          activeCurrency
                        )} por CD`
                      : 'Somado ao Frete Interno do pacote'}
                  </p>
                </div>

                <div>
                  <label className="block text-xs text-slate-300 mb-1">
                    Código de Rastreio Local
                  </label>
                  <input
                    type="text"
                    placeholder="Ex: RM883920112GB"
                    value={localTrackingCode}
                    onChange={(e) =>
                      setLocalTrackingCode(e.target.value.toUpperCase())
                    }
                    className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-base sm:text-sm text-white font-mono uppercase placeholder-slate-600 focus:border-purple-500 focus:outline-none"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Rastreio interno no país de origem
                  </p>
                </div>

                <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2 border-t border-slate-700/50">
                  <div>
                    <label className="block text-xs text-slate-300 mb-1 flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1">
                        <Link2 className="w-3.5 h-3.5 text-purple-400" /> Link do Anúncio eBay
                      </span>
                      {ebayListingUrl.trim().startsWith('http') && (
                        <a
                          href={ebayListingUrl.trim()}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-mono text-purple-300 hover:text-purple-200 underline"
                        >
                          Abrir Anúncio <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </label>
                    <input
                      type="text"
                      placeholder="https://www.ebay.co.uk/itm/..."
                      value={ebayListingUrl}
                      onChange={(e) => setEbayListingUrl(e.target.value)}
                      className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-white font-mono placeholder-slate-600 focus:border-purple-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-300 mb-1 flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1">
                        <Link2 className="w-3.5 h-3.5 text-sky-400" /> Pedido eBay (Link ou Nº)
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
                              ? `#${info.ebayOrderId}`
                              : 'Abrir Pedido'}{' '}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        );
                      })()}
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: 04-15363-94135 ou https://order.ebay.com/..."
                      value={ebayOrderInput}
                      onChange={(e) => setEbayOrderInput(e.target.value)}
                      className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-white font-mono placeholder-slate-600 focus:border-purple-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer Fixo */}
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
              className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-600/25 transition"
            >
              {editingItem
                ? 'Salvar Alterações'
                : isBundle && enableBatchCreate
                ? `Adicionar ${batchEntries.length} CDs do Lote`
                : 'Adicionar CD ao Pacote'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
