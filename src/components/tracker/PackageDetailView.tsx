'use client';

import React, { useState } from 'react';
import {
  ArrowLeft,
  Plus,
  Package,
  Check,
  X,
  Lock,
  Unlock,
  PackageOpen,
  PackageCheck,
  Calendar,
  Scale,
  Truck,
  ExternalLink,
  RotateCcw,
  Sparkles,
  Edit3,
  Copy,
  Trash2,
  Disc3,
  Receipt,
  Info,
  Box,
  Loader2,
  ImageIcon,
  ArrowUpDown,
  Layers,
} from 'lucide-react';
import {
  Shipment,
  ShipmentStatus,
  ShipmentSummary,
  CDItem,
  CalculatedCDItem,
} from '@/types/tracker';
import { STATUS_LABELS } from '@/components/ShipmentModal';
import {
  formatBrl,
  formatOriginalCurrency,
  formatWeightKg,
  formatShortBundleBadge,
} from '@/lib/formatters';
import { MG_TAX_FACTOR } from '@/lib/calculations';
import { AlbumCover } from '@/components/AlbumCover';

interface PackageDetailViewProps {
  mobileActivePane: 'list' | 'detail';
  onBackToList: () => void;
  filteredShipmentsCount: number;
  selectedSummary: ShipmentSummary | null;
  searchQuery: string;
  displayedCDItems: CalculatedCDItem[];
  cdSortBy: 'created' | 'artist' | 'cost_desc' | 'cost_asc';
  onCdSortByChange: (sortBy: 'created' | 'artist' | 'cost_desc' | 'cost_asc') => void;
  isFetchingCoversBatch: boolean;
  onFetchAllCovers: () => void;
  onOpenNewShipmentModal: () => void;
  onEditShipment: (shipment: Shipment) => void;
  onDuplicateShipment: (shipment: Shipment) => void;
  onDeleteShipment: (shipment: Shipment) => void;
  onRevertPackageToSingle: (shipment: Shipment) => void;
  onApplyMgTaxEstimate: (summary: ShipmentSummary) => void;
  onQuickStatusChange: (shipmentId: string, status: ShipmentStatus) => void;
  onSavePackageTitle: (shipment: Shipment, newTitle: string) => void;
  onTogglePackageCustomNameLock: (shipment: Shipment) => void;
  onSavePackageWeight: (shipmentId: string, weightKg: number | undefined) => void;
  onOpenAddCD: () => void;
  onEditCD: (cd: CDItem) => void;
  onDeleteCD: (cd: CDItem) => void;
  onExtractCdToSingle: (cd: CDItem) => void;
  onSaveInlineEditCD: (cd: CDItem, artist: string, album: string) => void;
  showToast: (msg: string) => void;
}

export const PackageDetailView: React.FC<PackageDetailViewProps> = ({
  mobileActivePane,
  onBackToList,
  filteredShipmentsCount,
  selectedSummary,
  searchQuery,
  displayedCDItems,
  cdSortBy,
  onCdSortByChange,
  isFetchingCoversBatch,
  onFetchAllCovers,
  onOpenNewShipmentModal,
  onEditShipment,
  onDuplicateShipment,
  onDeleteShipment,
  onRevertPackageToSingle,
  onApplyMgTaxEstimate,
  onQuickStatusChange,
  onSavePackageTitle,
  onTogglePackageCustomNameLock,
  onSavePackageWeight,
  onOpenAddCD,
  onEditCD,
  onDeleteCD,
  onExtractCdToSingle,
  onSaveInlineEditCD,
  showToast,
}) => {
  // Estados para edição inline do título do pacote
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');

  // Estados para edição inline do peso do pacote
  const [isEditingWeight, setIsEditingWeight] = useState(false);
  const [weightDraft, setWeightDraft] = useState('');

  // Estados para edição rápida inline de CDs (artista / álbum)
  const [inlineEditingId, setInlineEditingId] = useState<string | null>(null);
  const [inlineArtist, setInlineArtist] = useState('');
  const [inlineAlbum, setInlineAlbum] = useState('');

  const handleCommitTitle = (shipment: Shipment) => {
    const trimmed = titleDraft.trim();
    setIsEditingTitle(false);
    if (!trimmed) return;
    onSavePackageTitle(shipment, trimmed);
  };

  const handleCommitWeight = (shipmentId: string) => {
    const parsed = Math.max(0, parseFloat(weightDraft) || 0);
    setIsEditingWeight(false);
    const weightVal = parsed > 0 ? Number(parsed.toFixed(3)) : undefined;
    onSavePackageWeight(shipmentId, weightVal);
    showToast(
      parsed > 0 ? `Peso atualizado para ${formatWeightKg(parsed)}!` : 'Peso removido.'
    );
  };

  const handleCommitInlineCD = (item: CDItem) => {
    const newArtist = inlineArtist.trim() || item.artist;
    const newAlbum = inlineAlbum.trim() || item.albumTitle;
    setInlineEditingId(null);
    onSaveInlineEditCD(item, newArtist, newAlbum);
  };

  return (
    <section
      className={`${
        mobileActivePane === 'list' ? 'hidden lg:block' : 'block'
      } lg:col-span-8 xl:col-span-8 space-y-5`}
    >
      {/* Barra de Navegação Mobile Nativa (← Voltar para a Lista de Pacotes) */}
      <div className="flex items-center justify-between gap-2 lg:hidden">
        <button
          type="button"
          onClick={onBackToList}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 border border-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:text-white active:scale-95 transition"
        >
          <ArrowLeft className="w-4 h-4 text-indigo-400" />
          Voltar para Pacotes ({filteredShipmentsCount})
        </button>

        <button
          type="button"
          onClick={onOpenNewShipmentModal}
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
              Selecione um pacote na lista ou crie um novo pacote para começar a
              lançar seus CDs.
            </p>
          </div>
          <button
            onClick={onOpenNewShipmentModal}
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
                  {isEditingTitle ? (
                    <div className="flex items-center gap-1.5 flex-1 min-w-[220px] max-w-md">
                      <input
                        type="text"
                        autoFocus
                        value={titleDraft}
                        onChange={(e) => setTitleDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleCommitTitle(selectedSummary.shipment);
                          } else if (e.key === 'Escape') {
                            setIsEditingTitle(false);
                          }
                        }}
                        className="flex-1 rounded-lg bg-slate-950 border border-indigo-500 px-2.5 py-1 text-sm font-bold text-white focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => handleCommitTitle(selectedSummary.shipment)}
                        className="p-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500"
                        title="Salvar nome personalizado"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsEditingTitle(false)}
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
                          setTitleDraft(selectedSummary.shipment.name);
                          setIsEditingTitle(true);
                        }}
                        title="Clique para personalizar o nome deste pacote"
                        className="text-lg sm:text-xl font-bold text-white cursor-pointer hover:text-indigo-300 transition truncate"
                      >
                        {selectedSummary.shipment.name}
                      </h2>
                      <button
                        type="button"
                        onClick={() => onTogglePackageCustomNameLock(selectedSummary.shipment)}
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
                      onQuickStatusChange(
                        selectedSummary.shipment.id,
                        e.target.value as ShipmentStatus
                      )
                    }
                    className={`rounded-full border px-3 py-1 text-xs font-semibold cursor-pointer focus:outline-none ${
                      STATUS_LABELS[selectedSummary.shipment.status].badgeClass
                    }`}
                  >
                    <option value="comprado" className="bg-slate-900 text-white">
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
                            selectedSummary.shipment.shippingDate + 'T12:00:00'
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

                  {isEditingWeight ? (
                    <span className="inline-flex items-center gap-1">
                      <Scale className="w-3.5 h-3.5 text-emerald-400" />
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        autoFocus
                        placeholder="0.80"
                        value={weightDraft}
                        onChange={(e) => setWeightDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleCommitWeight(selectedSummary.shipment.id);
                          } else if (e.key === 'Escape') {
                            setIsEditingWeight(false);
                          }
                        }}
                        className="w-20 rounded bg-slate-950 border border-emerald-500 px-2 py-0.5 text-xs font-mono text-white focus:outline-none"
                      />
                      <span className="text-[11px] font-mono text-slate-400">
                        kg
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCommitWeight(selectedSummary.shipment.id)}
                        className="p-1 rounded bg-emerald-600 text-white hover:bg-emerald-500"
                        title="Salvar peso"
                      >
                        <Check className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsEditingWeight(false)}
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
                        setWeightDraft(
                          selectedSummary.weightKg
                            ? String(selectedSummary.weightKg)
                            : ''
                        );
                        setIsEditingWeight(true);
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
                      href={`https://portalimportador.correios.com.br/pages/pesquisarRemessaImportador/pesquisarRemessaImportador.jsf#track=${encodeURIComponent(
                        selectedSummary.shipment.internationalTrackingCode.trim()
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => {
                        const code =
                          selectedSummary.shipment.internationalTrackingCode?.trim();
                        if (code && navigator.clipboard?.writeText) {
                          navigator.clipboard
                            .writeText(code)
                            .then(() => {
                              showToast(
                                `Código ${code} copiado! Cole (Cmd+V / Ctrl+V) na busca dos Correios.`
                              );
                            })
                            .catch(() => {});
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded-md bg-sky-500/15 border border-sky-500/30 px-2 py-0.5 font-mono text-[11px] text-sky-300 hover:bg-sky-500/25 transition"
                      title="Abrir Minhas Importações (Correios) com o código de rastreio"
                    >
                      <Truck className="w-3 h-3" />
                      {selectedSummary.shipment.internationalTrackingCode}
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  )}

                  {(selectedSummary.shipment.ebayOrderUrl ||
                    selectedSummary.shipment.ebayOrderId) && (
                    <a
                      href={
                        selectedSummary.shipment.ebayOrderUrl ||
                        `https://order.ebay.com/ord/show?orderId=${selectedSummary.shipment.ebayOrderId}`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-md bg-indigo-500/15 border border-indigo-500/30 px-2 py-0.5 font-mono text-[11px] text-indigo-300 hover:bg-indigo-500/25 transition"
                      title="Abrir detalhes do pedido original no eBay"
                    >
                      <span>
                        Pedido eBay{' '}
                        {selectedSummary.shipment.ebayOrderId
                          ? `#${selectedSummary.shipment.ebayOrderId}`
                          : ''}
                      </span>
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
                  selectedSummary.shipment.consolidationMode === 'group_only' ||
                  selectedSummary.shipment.consolidationMode === 'unpack_and_repack' ||
                  selectedSummary.items.some((cd) => cd.isConsolidated)) && (
                  <button
                    type="button"
                    onClick={() => onRevertPackageToSingle(selectedSummary.shipment)}
                    title="Desfaz o status de consolidado deste pacote para que seus CDs fiquem disponíveis novamente para consolidação"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-700 border border-slate-600/80 px-3 py-2 text-xs font-medium text-slate-200 transition"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-sky-400" />
                    <span>Voltar p/ Pacote Único</span>
                  </button>
                )}

                <button
                  onClick={() => onApplyMgTaxEstimate(selectedSummary)}
                  title={`Calcula (Soma dos CDs) * Câmbio * ${MG_TAX_FACTOR} (apenas sobre o valor dos produtos)`}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 px-3 py-2 text-xs font-semibold text-amber-300 transition"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>
                    Estimar MG ({formatBrl(selectedSummary.estimatedTaxMgBrl)})
                  </span>
                </button>

                <button
                  onClick={() => onEditShipment(selectedSummary.shipment)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-2 text-xs font-medium text-slate-200 transition"
                >
                  <Edit3 className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Editar Pacote</span>
                </button>

                <button
                  onClick={() => onDuplicateShipment(selectedSummary.shipment)}
                  title="Criar uma cópia deste pacote com todas as taxas e CDs"
                  className="inline-flex items-center justify-center rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 p-2 text-slate-300 hover:text-white transition"
                >
                  <Copy className="w-4 h-4 text-sky-400" />
                </button>

                <button
                  onClick={() => onDeleteShipment(selectedSummary.shipment)}
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
                  Toque no título de qualquer álbum para renomear ou na capa
                  para escolher outra arte.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {selectedSummary.items.length > 0 && (
                  <button
                    onClick={onFetchAllCovers}
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
                      onCdSortByChange(
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
                  onClick={onOpenAddCD}
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
                    &ldquo;Editar Pacote&rdquo; para lançar os discos e calcular o
                    rateio em tempo real.
                  </p>
                </div>
                <button
                  onClick={onOpenAddCD}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 px-4 py-2 text-xs font-semibold text-white transition"
                >
                  <Plus className="w-4 h-4" />
                  Adicionar Primeiro CD
                </button>
              </div>
            ) : (
              <>
                {/* VISÃO MOBILE (< md): CARDS DE ÁLBUM SEM SCROLL HORIZONTAL */}
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
                            onClick={() => onEditCD(item)}
                            className="relative h-14 w-14 rounded-xl bg-slate-900 border border-slate-700/80 flex items-center justify-center overflow-hidden shrink-0 shadow"
                          >
                            <AlbumCover
                              src={item.coverUrl}
                              alt={item.albumTitle}
                              iconClassName="w-6 h-6 text-slate-600"
                            />
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
                                    onClick={() => handleCommitInlineCD(item)}
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

                                  {item.packingHandling === 'unpacked' && (
                                    <span className="rounded bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 text-[10px] text-amber-300 whitespace-nowrap">
                                      Fora da caixa
                                    </span>
                                  )}
                                  {item.packingHandling === 'original_box' && (
                                    <span className="rounded bg-indigo-500/15 border border-indigo-500/30 px-1.5 py-0.5 text-[10px] text-indigo-300 whitespace-nowrap">
                                      Caixa original
                                    </span>
                                  )}
                                  {item.discCount > 1 && (
                                    <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-mono text-indigo-300 whitespace-nowrap">
                                      Box {item.discCount} CDs
                                    </span>
                                  )}
                                  {(item.ebayListingUrl ||
                                    item.ebayOrderUrl ||
                                    item.ebayOrderId) && (
                                    <a
                                      href={
                                        item.ebayListingUrl ||
                                        item.ebayOrderUrl ||
                                        `https://order.ebay.com/ord/show?orderId=${item.ebayOrderId}`
                                      }
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="inline-flex items-center gap-1 rounded bg-sky-500/15 border border-sky-500/30 px-1.5 py-0.5 text-[10px] font-mono text-sky-300 hover:bg-sky-500/25 whitespace-nowrap"
                                      title="Abrir anúncio ou pedido original no eBay"
                                    >
                                      <span>
                                        {item.ebayListingUrl
                                          ? 'Anúncio eBay'
                                          : item.ebayOrderId
                                          ? `#${item.ebayOrderId}`
                                          : 'Pedido eBay'}
                                      </span>
                                      <ExternalLink className="w-2.5 h-2.5" />
                                    </a>
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
                              + {formatBrl(item.allocatedIndirectCostBrl)} rateio
                            </span>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {canRevertCd && (
                              <button
                                type="button"
                                onClick={() => onExtractCdToSingle(item)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium text-sky-300 hover:text-white bg-slate-900 border border-slate-800"
                                title="Voltar este CD para Comprado (Pacote Único)"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>Pacote Único</span>
                              </button>
                            )}
                            <button
                              onClick={() => onEditCD(item)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-white bg-slate-900"
                              title="Editar CD"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => onDeleteCD(item)}
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

                {/* VISÃO DESKTOP (md+): TABELA ENXUTA DE 5 COLUNAS */}
                <div className="hidden md:block rounded-xl border border-slate-800 overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-950/90 text-[11px] font-semibold uppercase tracking-wider text-slate-400 whitespace-nowrap">
                        <th className="py-3 px-4">Capa, Artista & Álbum</th>
                        <th className="py-3 px-3 text-right">Valor do CD</th>
                        <th className="py-3 px-3 text-right">+ Rateio Unit.</th>
                        <th className="py-3 px-4 text-right">Custo Final (BRL)</th>
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

                        const isInlineEditing = inlineEditingId === item.id;
                        const canRevertCd =
                          selectedSummary.shipment.status !== 'comprado' ||
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
                                  onClick={() => onEditCD(item)}
                                  title="Clique para trocar ou buscar a capa deste álbum"
                                  className="group relative h-12 w-12 rounded-lg bg-slate-900 border border-slate-700/80 flex items-center justify-center overflow-hidden shrink-0 shadow hover:border-indigo-400 transition"
                                >
                                  <AlbumCover
                                    src={item.coverUrl}
                                    alt={item.albumTitle}
                                    iconClassName="w-5 h-5 text-slate-600 group-hover:text-indigo-400 transition"
                                  />
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
                                              handleCommitInlineCD(item);
                                            } else if (e.key === 'Escape') {
                                              setInlineEditingId(null);
                                            }
                                          }}
                                          placeholder="Nome do Álbum"
                                          className="flex-1 rounded bg-slate-900 border border-indigo-500 px-2 py-1 text-xs text-white focus:outline-none"
                                        />
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleCommitInlineCD(item)
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
                                              selectedSummary.shipment.currency
                                            )} ÷ ${
                                              item.bundleTotalQuantity || 1
                                            }${
                                              item.bundleName
                                                ? ` — ${item.bundleName}`
                                                : ''
                                            }`}
                                          >
                                            <Layers className="w-2.5 h-2.5 shrink-0" />
                                            {formatShortBundleBadge(
                                              item,
                                              selectedSummary.shipment.name
                                            )}
                                          </span>
                                        ) : (
                                          <span className="inline-flex items-center rounded bg-slate-800/80 px-1.5 py-0.5 text-[10px] text-slate-400 whitespace-nowrap">
                                            Avulso
                                          </span>
                                        )}

                                        {item.packingHandling === 'unpacked' && (
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
                                        {(item.ebayListingUrl ||
                                          item.ebayOrderUrl ||
                                          item.ebayOrderId) && (
                                          <a
                                            href={
                                              item.ebayListingUrl ||
                                              item.ebayOrderUrl ||
                                              `https://order.ebay.com/ord/show?orderId=${item.ebayOrderId}`
                                            }
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            onClick={(e) => e.stopPropagation()}
                                            className="inline-flex items-center gap-1 rounded bg-sky-500/15 border border-sky-500/30 px-1.5 py-0.5 text-[10px] font-mono text-sky-300 hover:bg-sky-500/25 transition whitespace-nowrap"
                                            title="Abrir anúncio ou pedido original no eBay"
                                          >
                                            <span>
                                              {item.ebayListingUrl
                                                ? 'Anúncio eBay'
                                                : item.ebayOrderId
                                                ? `#${item.ebayOrderId}`
                                                : 'Pedido eBay'}
                                            </span>
                                            <ExternalLink className="w-2.5 h-2.5" />
                                          </a>
                                        )}
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
                                        title="Clique para renomear o álbum e buscar a capa"
                                        className="text-xs text-slate-300 hover:text-indigo-300 cursor-pointer flex items-center gap-1.5 mt-0.5 group/title"
                                      >
                                        <span
                                          className={`truncate ${
                                            item.albumTitle.startsWith('CD #')
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
                                  ({formatBrl(item.costPerDiscBrl)} / disco)
                                </div>
                              )}
                            </td>

                            {/* Coluna 5: Ações */}
                            <td className="py-3 px-3 text-center whitespace-nowrap">
                              <div className="inline-flex items-center gap-1 whitespace-nowrap">
                                {canRevertCd && (
                                  <button
                                    type="button"
                                    onClick={() => onExtractCdToSingle(item)}
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
                                  onClick={() => onEditCD(item)}
                                  title="Editar detalhes e escolher capa do álbum"
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                                >
                                  <Edit3 className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => onDeleteCD(item)}
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
  );
};
