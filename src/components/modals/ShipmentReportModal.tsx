'use client';

import React, { useMemo, useState } from 'react';
import {
  Printer,
  X,
  Package,
  Layers,
  Info,
  CheckCircle2,
  FileText,
} from 'lucide-react';
import { Shipment, CDItem } from '@/types/tracker';
import { calculateShipmentSummary, formatBrl } from '@/lib/calculations';

interface ShipmentReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  shipments: Shipment[];
  items: CDItem[];
  defaultSelectedShipmentId?: string;
}

interface OriginPackageGroup {
  key: string;
  name: string;
  isBundle: boolean;
  ebayOrderId?: string;
  ebayOrderUrl?: string;
  localTrackingCode?: string;
  itemCount: number;
}

export function ShipmentReportModal({
  isOpen,
  onClose,
  shipments,
  items,
  defaultSelectedShipmentId,
}: ShipmentReportModalProps) {
  // Filtra apenas pacotes que já foram tributados ou entregues (possuem dados consolidados e fechados)
  const eligibleShipments = useMemo(() => {
    return shipments.filter(
      (s) => s.status === 'tributado' || s.status === 'entregue'
    );
  }, [shipments]);

  // Modo de visualização: 'all' (todos os tributados/entregues) ou 'single' (apenas um selecionado)
  const [reportScope, setReportScope] = useState<'all' | 'single'>(() => {
    if (
      defaultSelectedShipmentId &&
      eligibleShipments.some((s) => s.id === defaultSelectedShipmentId)
    ) {
      return 'single';
    }
    return 'all';
  });

  const [selectedShipmentId, setSelectedShipmentId] = useState<string>(() => {
    if (
      defaultSelectedShipmentId &&
      eligibleShipments.some((s) => s.id === defaultSelectedShipmentId)
    ) {
      return defaultSelectedShipmentId;
    }
    return eligibleShipments[0]?.id || '';
  });

  // Atualiza se defaultSelectedShipmentId mudar quando modal abrir
  React.useEffect(() => {
    if (
      defaultSelectedShipmentId &&
      eligibleShipments.some((s) => s.id === defaultSelectedShipmentId)
    ) {
      setSelectedShipmentId(defaultSelectedShipmentId);
    } else if (eligibleShipments.length > 0) {
      setSelectedShipmentId((prev) =>
        prev && eligibleShipments.some((s) => s.id === prev)
          ? prev
          : eligibleShipments[0].id
      );
    }
  }, [defaultSelectedShipmentId, eligibleShipments]);

  const summaries = useMemo(() => {
    return eligibleShipments.map((shipment) => {
      const summary = calculateShipmentSummary(shipment, items);
      const exchangeRate = Number(shipment.exchangeRate) || 1;

      // Agrupa os itens para identificar os pacotes/lotes de origem
      const originGroupsMap = new Map<string, OriginPackageGroup>();

      summary.items.forEach((item) => {
        let groupKey = 'single-items';
        let groupName = 'Compras Avulsas Individuais';

        if (item.isBundle || item.bundleName || item.bundleId) {
          groupKey = item.bundleId || item.bundleName || `bundle-${item.id}`;
          groupName = item.bundleName || `Lote eBay (${item.bundleId || 'Identificado'})`;
        } else if (item.ebayOrderId) {
          groupKey = `order-${item.ebayOrderId}`;
          groupName = `Pedido eBay #${item.ebayOrderId}`;
        } else if (item.localTrackingCode) {
          groupKey = `track-${item.localTrackingCode}`;
          groupName = `Envio Local (${item.localTrackingCode})`;
        } else {
          groupKey = `item-${item.id}`;
          groupName = `${item.artist} - ${item.albumTitle}`;
        }

        const existing = originGroupsMap.get(groupKey);
        if (existing) {
          existing.itemCount += 1;
          if (!existing.ebayOrderId && item.ebayOrderId) {
            existing.ebayOrderId = item.ebayOrderId;
            existing.ebayOrderUrl = item.ebayOrderUrl;
          }
          if (!existing.localTrackingCode && item.localTrackingCode) {
            existing.localTrackingCode = item.localTrackingCode;
          }
        } else {
          originGroupsMap.set(groupKey, {
            key: groupKey,
            name: groupName,
            isBundle: Boolean(item.isBundle || item.bundleName),
            ebayOrderId: item.ebayOrderId,
            ebayOrderUrl: item.ebayOrderUrl,
            localTrackingCode: item.localTrackingCode,
            itemCount: 1,
          });
        }
      });

      const originGroups = Array.from(originGroupsMap.values());

      // Custos convertidos para BRL
      const totalInternalShippingBrl =
        summary.totalInternalShippingOriginal * exchangeRate;
      const forwarderFeeBrl = (Number(shipment.forwarderFee) || 0) * exchangeRate;
      const internationalShippingBrl =
        (Number(shipment.internationalShipping) || 0) * exchangeRate;
      const customsTaxBrl = Number(shipment.customsTaxBrl) || 0;

      return {
        summary,
        exchangeRate,
        originGroups,
        costsBrl: {
          itemsBrl: summary.totalItemsBrl,
          internalShippingBrl: totalInternalShippingBrl,
          forwarderFeeBrl,
          internationalShippingBrl,
          customsTaxBrl,
          totalIndirectBrl: summary.totalIndirectCostBrl,
          allocatedCostPerItemBrl: summary.allocatedCostPerItemBrl,
          totalShipmentCostBrl: summary.totalShipmentCostBrl,
        },
      };
    });
  }, [eligibleShipments, items]);

  // Totais agregados gerais de todos os pacotes tributados/entregues
  const globalExecutiveSummary = useMemo(() => {
    let totalItems = 0;
    let totalItemsBrl = 0;
    let totalInternalShippingBrl = 0;
    let totalForwarderFeeBrl = 0;
    let totalInternationalShippingBrl = 0;
    let totalCustomsTaxBrl = 0;
    let totalShipmentCostBrl = 0;

    summaries.forEach((s) => {
      totalItems += s.summary.totalItemsCount;
      totalItemsBrl += s.costsBrl.itemsBrl;
      totalInternalShippingBrl += s.costsBrl.internalShippingBrl;
      totalForwarderFeeBrl += s.costsBrl.forwarderFeeBrl;
      totalInternationalShippingBrl += s.costsBrl.internationalShippingBrl;
      totalCustomsTaxBrl += s.costsBrl.customsTaxBrl;
      totalShipmentCostBrl += s.costsBrl.totalShipmentCostBrl;
    });

    const totalFreightAndHandlingBrl =
      totalInternalShippingBrl +
      totalForwarderFeeBrl +
      totalInternationalShippingBrl;
    const avgCostPerItemBrl =
      totalItems > 0 ? totalShipmentCostBrl / totalItems : 0;

    return {
      totalPackages: summaries.length,
      totalItems,
      totalItemsBrl,
      totalFreightAndHandlingBrl,
      totalCustomsTaxBrl,
      totalShipmentCostBrl,
      avgCostPerItemBrl,
    };
  }, [summaries]);

  const displayedSummaries = useMemo(() => {
    if (reportScope === 'all') return summaries;
    return summaries.filter((s) => s.summary.shipment.id === selectedShipmentId);
  }, [reportScope, summaries, selectedShipmentId]);

  if (!isOpen) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div
      id="report-modal-root"
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/85 backdrop-blur-sm print:static print:bg-white print:overflow-visible print:p-0"
    >
      <div className="min-h-full p-2 sm:p-4 md:p-6 flex items-center justify-center print:p-0 print:block">
        <div className="w-full max-w-5xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden print:border-none print:shadow-none print:rounded-none print:bg-white print:text-black">
          {/* BARRA SUPERIOR DE CONTROLES (Oculta na Impressão) */}
          <div className="p-4 sm:p-5 bg-slate-950/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 print:hidden">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-bold text-white">
                  Relatório de Fechamento de Custos
                </h2>
                <p className="text-xs text-slate-400">
                  Valores finais consolidados em Reais (BRL) e rateio unitário por item
                </p>
              </div>
            </div>

            {/* Ações e Seletor de Escopo */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              {eligibleShipments.length > 0 && (
                <div className="inline-flex items-center p-0.5 rounded-lg bg-slate-900 border border-slate-700 text-xs">
                  <button
                    type="button"
                    onClick={() => setReportScope('all')}
                    className={`px-3 py-1 rounded-md font-medium transition cursor-pointer ${
                      reportScope === 'all'
                        ? 'bg-indigo-600 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Todos ({eligibleShipments.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setReportScope('single')}
                    className={`px-3 py-1 rounded-md font-medium transition cursor-pointer ${
                      reportScope === 'single'
                        ? 'bg-indigo-600 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Pacote Único
                  </button>
                </div>
              )}

              {reportScope === 'single' && eligibleShipments.length > 0 && (
                <select
                  value={selectedShipmentId}
                  onChange={(e) => setSelectedShipmentId(e.target.value)}
                  className="rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200 py-1.5 px-2.5 focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  {eligibleShipments.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.status === 'entregue' ? 'Entregue' : 'Tributado'})
                    </option>
                  ))}
                </select>
              )}

              <button
                type="button"
                onClick={handlePrint}
                disabled={eligibleShipments.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold px-3 py-1.5 shadow-md shadow-emerald-600/20 transition cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>Imprimir / Salvar PDF</span>
              </button>

              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
                title="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* CORPO DO RELATÓRIO */}
          <div className="p-4 sm:p-6 md:p-8 space-y-8 print:p-0 print:space-y-6">
            {/* Caso não haja pacotes tributados ou entregues */}
            {eligibleShipments.length === 0 && (
              <div className="text-center py-12 px-4 rounded-xl bg-slate-950/50 border border-slate-800">
                <Info className="w-10 h-10 text-amber-400 mx-auto mb-3" />
                <h3 className="text-base font-semibold text-white mb-1">
                  Nenhum pacote tributado ou entregue encontrado
                </h3>
                <p className="text-sm text-slate-400 max-w-md mx-auto">
                  Este relatório detalha os custos finais consolidados (tributos, fretes e rateios). Ele é gerado para pacotes com status <strong>Tributado</strong> ou <strong>Entregue</strong>, pois apenas estes já possuem todos os dados de fechamento alfandegário.
                </p>
              </div>
            )}

            {/* CABEÇALHO DO DOCUMENTO IMPRESSO */}
            {eligibleShipments.length > 0 && (
              <div className="border-b border-slate-700 pb-4 print:border-black print:pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className="text-xl sm:text-2xl font-black text-white print:text-black tracking-tight">
                      CD IMPORT TRACKER - DEMONSTRATIVO DE CUSTOS
                    </h1>
                    <p className="text-xs sm:text-sm text-slate-400 print:text-neutral-600">
                      Relatório analítico por pacote com rateio de despesas alfandegárias e fretes
                    </p>
                  </div>
                  <div className="text-right text-xs text-slate-400 print:text-neutral-600">
                    <div>Data de Emissão: {new Date().toLocaleDateString('pt-BR')}</div>
                    <div>Modo: {reportScope === 'all' ? 'Consolidado Geral' : 'Ficha de Pacote'}</div>
                  </div>
                </div>
              </div>
            )}

            {/* RESUMO GERAL EXECUTIVO (Quando escopo for 'all') */}
            {reportScope === 'all' && eligibleShipments.length > 0 && (
              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 sm:p-5 print:bg-neutral-50 print:border-neutral-300 print:p-4 print-avoid-break">
                <div className="flex items-center justify-between mb-3 border-b border-slate-800 print:border-neutral-300 pb-2">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-indigo-300 print:text-black flex items-center gap-2">
                    <Layers className="w-4 h-4" />
                    Resumo Executivo Consolidado
                  </h3>
                  <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 print:bg-neutral-200 print:text-black print:border-neutral-400">
                    {globalExecutiveSummary.totalPackages} Pacote(s) Concluído(s)
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 print:bg-white print:border-neutral-300">
                    <div className="text-[10px] text-slate-400 print:text-neutral-600 uppercase font-medium">Total Itens</div>
                    <div className="text-base font-bold font-mono text-white print:text-black">
                      {globalExecutiveSummary.totalItems} CDs/Itens
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 print:bg-white print:border-neutral-300">
                    <div className="text-[10px] text-slate-400 print:text-neutral-600 uppercase font-medium">Custo dos CDs</div>
                    <div className="text-base font-bold font-mono text-indigo-300 print:text-black">
                      {formatBrl(globalExecutiveSummary.totalItemsBrl)}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 print:bg-white print:border-neutral-300">
                    <div className="text-[10px] text-slate-400 print:text-neutral-600 uppercase font-medium">Fretes + Redirec.</div>
                    <div className="text-base font-bold font-mono text-amber-300 print:text-black">
                      {formatBrl(globalExecutiveSummary.totalFreightAndHandlingBrl)}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 print:bg-white print:border-neutral-300">
                    <div className="text-[10px] text-slate-400 print:text-neutral-600 uppercase font-medium">Impostos (II+ICMS)</div>
                    <div className="text-base font-bold font-mono text-rose-300 print:text-black">
                      {formatBrl(globalExecutiveSummary.totalCustomsTaxBrl)}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 print:bg-white print:border-neutral-300">
                    <div className="text-[10px] text-slate-400 print:text-neutral-600 uppercase font-medium">Investimento Total</div>
                    <div className="text-base font-bold font-mono text-emerald-400 print:text-black">
                      {formatBrl(globalExecutiveSummary.totalShipmentCostBrl)}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 print:bg-white print:border-neutral-300">
                    <div className="text-[10px] text-slate-400 print:text-neutral-600 uppercase font-medium">Custo Médio / CD</div>
                    <div className="text-base font-bold font-mono text-emerald-300 print:text-black">
                      {formatBrl(globalExecutiveSummary.avgCostPerItemBrl)}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* LISTAGEM DE PACOTES INDIVIDUAIS */}
            <div className="space-y-10 print:space-y-8">
              {displayedSummaries.map((pkg, idx) => {
                const { shipment } = pkg.summary;
                const isLast = idx === displayedSummaries.length - 1;

                // Modo de Consolidação amigável
                let forwarderModeLabel = 'Envio Direto / Não Consolidado';
                if (shipment.consolidationMode === 'unpack_and_repack') {
                  forwarderModeLabel = 'Desempacotado e Reembalado (Novo volume compacto)';
                } else if (shipment.consolidationMode === 'group_only') {
                  forwarderModeLabel = 'Agrupamento Simples (Volumes originais reunidos)';
                }

                return (
                  <div
                    key={shipment.id}
                    className={`bg-slate-950/40 border border-slate-800/80 rounded-2xl p-4 sm:p-6 print:border print:border-neutral-300 print:rounded-none print:p-4 print-avoid-break ${
                      !isLast ? 'print-page-break' : ''
                    }`}
                  >
                    {/* CABEÇALHO DO PACOTE */}
                    <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800 print:border-neutral-300">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <Package className="w-5 h-5 text-indigo-400 print:text-black" />
                          <h2 className="text-lg font-bold text-white print:text-black">
                            {shipment.name}
                          </h2>
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full font-semibold border print:border-black print:text-black ${
                              shipment.status === 'entregue'
                                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400 print:bg-neutral-200'
                                : 'bg-rose-500/15 border-rose-500/30 text-rose-400 print:bg-neutral-200'
                            }`}
                          >
                            {shipment.status === 'entregue' ? 'Entregue' : 'Tributado'}
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 print:text-neutral-700 flex flex-wrap gap-x-4 gap-y-1">
                          {shipment.shippingDate && (
                            <span>Data Envio: <strong>{shipment.shippingDate}</strong></span>
                          )}
                          {shipment.internationalTrackingCode && (
                            <span>Rastreio BR: <strong>{shipment.internationalTrackingCode}</strong></span>
                          )}
                          <span>
                            Câmbio Aplicado: <strong>R$ {pkg.exchangeRate.toFixed(2)}</strong> / {shipment.currency}
                          </span>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="text-[10px] uppercase tracking-wider text-slate-400 print:text-neutral-600 block">
                          Custo Total do Pacote
                        </span>
                        <span className="text-xl font-black font-mono text-emerald-400 print:text-black">
                          {formatBrl(pkg.costsBrl.totalShipmentCostBrl)}
                        </span>
                      </div>
                    </div>

                    {/* BLOCO DE HISTÓRICO DE CONSOLIDAÇÃO */}
                    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                      {/* 1. Consolidação de Origem (Compras / Lotes) */}
                      <div className="rounded-xl bg-slate-900/90 border border-slate-800 p-3.5 print:bg-neutral-50 print:border-neutral-300">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-300 print:text-black mb-2 flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400 print:text-black" />
                          Pacotes de Origem Consolidados ({pkg.originGroups.length})
                        </h4>
                        <div className="space-y-1.5 text-xs">
                          {pkg.originGroups.map((group) => (
                            <div
                              key={group.key}
                              className="flex items-start justify-between gap-2 p-1.5 rounded bg-slate-950/60 border border-slate-800/80 print:bg-white print:border-neutral-200"
                            >
                              <div className="min-w-0">
                                <div className="font-semibold text-slate-200 print:text-black truncate">
                                  {group.name}
                                </div>
                                <div className="text-[11px] text-slate-400 print:text-neutral-600 flex flex-wrap gap-x-2">
                                  {group.ebayOrderId && (
                                    <span>eBay: #{group.ebayOrderId}</span>
                                  )}
                                  {group.localTrackingCode && (
                                    <span>Rastreio: {group.localTrackingCode}</span>
                                  )}
                                </div>
                              </div>
                              <span className="shrink-0 font-medium px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 print:bg-neutral-100 print:text-black text-[11px]">
                                {group.itemCount} {group.itemCount === 1 ? 'item' : 'itens'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* 2. Consolidação no Redirecionador */}
                      <div className="rounded-xl bg-slate-900/90 border border-slate-800 p-3.5 print:bg-neutral-50 print:border-neutral-300">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-purple-300 print:text-black mb-2 flex items-center gap-1.5">
                          <Layers className="w-3.5 h-3.5 text-purple-400 print:text-black" />
                          Consolidação no Redirecionador
                        </h4>
                        <div className="space-y-2 text-xs">
                          <div>
                            <span className="text-slate-400 print:text-neutral-600 block text-[11px]">Modo de Preparação:</span>
                            <span className="font-semibold text-slate-200 print:text-black">
                              {forwarderModeLabel}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-800/60 print:border-neutral-200">
                            <div>
                              <span className="text-slate-400 print:text-neutral-600 block text-[11px]">Volumes Agrupados:</span>
                              <span className="font-semibold text-slate-200 print:text-black">
                                {shipment.sourcePackagesCount || pkg.originGroups.length} pacotes
                              </span>
                            </div>
                            <div>
                              <span className="text-slate-400 print:text-neutral-600 block text-[11px]">Taxa do Redirecionador:</span>
                              <span className="font-semibold text-purple-300 print:text-black">
                                {formatBrl(pkg.costsBrl.forwarderFeeBrl)}
                              </span>
                            </div>
                          </div>

                          <div className="pt-1 border-t border-slate-800/60 print:border-neutral-200">
                            <span className="text-slate-400 print:text-neutral-600 block text-[11px]">Frete Internacional p/ Brasil:</span>
                            <span className="font-semibold text-amber-300 print:text-black">
                              {formatBrl(pkg.costsBrl.internationalShippingBrl)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* DEMONSTRATIVO DE CUSTOS DETALHADO (BRL) */}
                    <div className="mt-4 rounded-xl bg-slate-900/70 border border-slate-800 p-3.5 print:bg-white print:border-neutral-300">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 print:text-black mb-3">
                        Detalhamento de Custos e Rateio (Todos em Reais - BRL)
                      </h4>

                      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 text-xs">
                        {/* Custo dos CDs */}
                        <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800 print:bg-neutral-50 print:border-neutral-200">
                          <span className="text-[10px] text-slate-400 print:text-neutral-600 uppercase block">1. Custo dos CDs</span>
                          <span className="font-bold font-mono text-indigo-300 print:text-black text-sm">
                            {formatBrl(pkg.costsBrl.itemsBrl)}
                          </span>
                        </div>

                        {/* Frete Interno / Local */}
                        <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800 print:bg-neutral-50 print:border-neutral-200">
                          <span className="text-[10px] text-slate-400 print:text-neutral-600 uppercase block">2. Frete Origem</span>
                          <span className="font-bold font-mono text-slate-200 print:text-black text-sm">
                            {formatBrl(pkg.costsBrl.internalShippingBrl)}
                          </span>
                        </div>

                        {/* Taxa Redirecionador */}
                        <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800 print:bg-neutral-50 print:border-neutral-200">
                          <span className="text-[10px] text-slate-400 print:text-neutral-600 uppercase block">3. Redirecionador</span>
                          <span className="font-bold font-mono text-purple-300 print:text-black text-sm">
                            {formatBrl(pkg.costsBrl.forwarderFeeBrl)}
                          </span>
                        </div>

                        {/* Frete p/ BR */}
                        <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800 print:bg-neutral-50 print:border-neutral-200">
                          <span className="text-[10px] text-slate-400 print:text-neutral-600 uppercase block">4. Frete p/ Brasil</span>
                          <span className="font-bold font-mono text-amber-300 print:text-black text-sm">
                            {formatBrl(pkg.costsBrl.internationalShippingBrl)}
                          </span>
                        </div>

                        {/* Imposto Alfandegário */}
                        <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800 print:bg-neutral-50 print:border-neutral-200">
                          <span className="text-[10px] text-slate-400 print:text-neutral-600 uppercase block">5. Impostos (II+ICMS)</span>
                          <span className="font-bold font-mono text-rose-300 print:text-black text-sm">
                            {formatBrl(pkg.costsBrl.customsTaxBrl)}
                          </span>
                        </div>

                        {/* Total Adicionais */}
                        <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800 print:bg-neutral-100 print:border-neutral-300">
                          <span className="text-[10px] text-slate-400 print:text-neutral-600 uppercase block">Custos Extras (2+3+4+5)</span>
                          <span className="font-bold font-mono text-amber-400 print:text-black text-sm">
                            {formatBrl(pkg.costsBrl.totalIndirectBrl)}
                          </span>
                        </div>

                        {/* Rateio por Item */}
                        <div className="p-2 rounded-lg bg-indigo-950/40 border border-indigo-800/50 print:bg-neutral-100 print:border-neutral-300">
                          <span className="text-[10px] text-indigo-300 print:text-black uppercase font-bold block">
                            Rateio / Item ({pkg.summary.totalItemsCount})
                          </span>
                          <span className="font-black font-mono text-indigo-400 print:text-black text-sm">
                            {formatBrl(pkg.costsBrl.allocatedCostPerItemBrl)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* TABELA DE ITENS (RATEIO POR ITEM E CUSTO FINAL) */}
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-slate-800 print:border-neutral-300 text-slate-400 print:text-black bg-slate-900/80 print:bg-neutral-100 font-semibold">
                            <th className="py-2 px-2.5 w-8">#</th>
                            <th className="py-2 px-2.5">Item (Artista - Álbum)</th>
                            <th className="py-2 px-2.5">Mídia</th>
                            <th className="py-2 px-2.5">Lote / Pedido Origem</th>
                            <th className="py-2 px-2.5 text-right">Custo Direto (CD)</th>
                            <th className="py-2 px-2.5 text-right">Rateio Extras</th>
                            <th className="py-2 px-2.5 text-right font-bold text-white print:text-black">Custo Final</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60 print:divide-neutral-200">
                          {pkg.summary.items.map((item, itemIdx) => {
                            const discCount = Number(item.discCount) || 1;
                            const mediaLabel =
                              item.mediaType === 'vinyl'
                                ? 'Vinil LP'
                                : discCount > 1
                                ? `CD Duplo/Box (${discCount} CDs)`
                                : 'CD';

                            return (
                              <tr
                                key={item.id}
                                className="hover:bg-slate-900/40 print:hover:bg-transparent"
                              >
                                <td className="py-2 px-2.5 text-slate-500 print:text-neutral-600 font-mono">
                                  {itemIdx + 1}
                                </td>
                                <td className="py-2 px-2.5">
                                  <div className="font-semibold text-slate-200 print:text-black">
                                    {item.artist}
                                  </div>
                                  <div className="text-[11px] text-slate-400 print:text-neutral-600">
                                    {item.albumTitle}
                                  </div>
                                </td>
                                <td className="py-2 px-2.5 text-slate-400 print:text-neutral-700">
                                  {mediaLabel}
                                </td>
                                <td className="py-2 px-2.5 text-slate-400 print:text-neutral-700">
                                  {item.bundleName ||
                                    (item.ebayOrderId ? `eBay #${item.ebayOrderId}` : 'Individual')}
                                </td>
                                <td className="py-2 px-2.5 text-right font-mono text-indigo-300 print:text-black">
                                  {formatBrl(item.directCostBrl)}
                                </td>
                                <td className="py-2 px-2.5 text-right font-mono text-amber-300 print:text-black">
                                  {formatBrl(item.allocatedIndirectCostBrl)}
                                </td>
                                <td className="py-2 px-2.5 text-right font-mono font-bold text-emerald-400 print:text-black">
                                  {formatBrl(item.finalCostBrl)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-slate-700 print:border-black font-bold text-slate-200 print:text-black bg-slate-900/50 print:bg-neutral-100">
                            <td colSpan={4} className="py-2 px-2.5 uppercase text-xs">
                              Totais do Pacote ({pkg.summary.totalItemsCount} {pkg.summary.totalItemsCount === 1 ? 'item' : 'itens'})
                            </td>
                            <td className="py-2 px-2.5 text-right font-mono text-indigo-300 print:text-black">
                              {formatBrl(pkg.costsBrl.itemsBrl)}
                            </td>
                            <td className="py-2 px-2.5 text-right font-mono text-amber-300 print:text-black">
                              {formatBrl(pkg.costsBrl.totalIndirectBrl)}
                            </td>
                            <td className="py-2 px-2.5 text-right font-mono text-emerald-400 print:text-black text-sm">
                              {formatBrl(pkg.costsBrl.totalShipmentCostBrl)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* RODAPÉ DO MODAL (Oculto na Impressão) */}
          <div className="p-4 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between print:hidden">
            <span className="text-xs text-slate-500">
              Dica: No diálogo de impressão, selecione &quot;Salvar como PDF&quot; como destino para gerar o arquivo.
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={handlePrint}
                disabled={eligibleShipments.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold px-4 py-1.5 shadow-md shadow-emerald-600/20 transition cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>Imprimir / Salvar PDF</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
