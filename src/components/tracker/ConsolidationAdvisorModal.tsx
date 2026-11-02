'use client';

import React, { useMemo, useState } from 'react';
import {
  Sparkles,
  Scale,
  Disc3,
  Package,
  X,
  CheckSquare,
  Layers,
  AlertTriangle,
  Info,
  TrendingDown,
  PackageOpen,
  PackageCheck,
} from 'lucide-react';
import { ConsolidationMode, CurrencyCode, Shipment } from '@/types/tracker';
import { ForwarderPackageOption } from '@/lib/domain/consolidation';
import {
  ConsolidationSuggestion,
  DEFAULT_ESTIMATED_GRAMS_PER_DISC,
  WEIGHT_TIER_OPTIONS,
  WeightTierKg,
  generateConsolidationAdvisorReport,
  getEstimatedIntlShippingForWeight,
} from '@/lib/domain/consolidationAdvisor';
import { loadFeePresetsForCurrency } from '@/lib/storage/feePresets';
import { CURRENCY_META } from '@/lib/calculations';
import {
  formatBrl,
  formatOriginalCurrency,
  formatWeightKg,
} from '@/lib/formatters';

interface ConsolidationAdvisorModalProps {
  isOpen: boolean;
  onClose: () => void;
  forwarderPackages: ForwarderPackageOption[];
  allShipments: Shipment[];
  onSelectPackagesInSidebar: (packageIds: string[]) => void;
  onConsolidateSuggestion: (suggestion: ConsolidationSuggestion) => void;
}

export const ConsolidationAdvisorModal: React.FC<
  ConsolidationAdvisorModalProps
> = ({
  isOpen,
  onClose,
  forwarderPackages,
  allShipments,
  onSelectPackagesInSidebar,
  onConsolidateSuggestion,
}) => {
  const [targetWeightKg, setTargetWeightKg] = useState<WeightTierKg>(1.0);
  // Se houver menos de 2 pacotes no redirecionador, já inicia com "Incluir Comprados" ativo para ser útil imediatamente
  const initialInForwarderCount = useMemo(
    () =>
      forwarderPackages.filter(
        (fp) => fp.shipment.status === 'no_redirecionador'
      ).length,
    [forwarderPackages]
  );

  const [includePurchased, setIncludePurchased] = useState<boolean>(
    initialInForwarderCount < 2
  );
  const [mode, setMode] = useState<Exclude<ConsolidationMode, 'direct'>>(
    'unpack_and_repack'
  );
  const [customIntlShipping, setCustomIntlShipping] = useState<string>('');

  // Moeda e câmbio baseados no pacote mais recente elegível (padrão GBP)
  const dominantCurrency: CurrencyCode = useMemo(() => {
    const first = forwarderPackages[0]?.shipment.currency;
    return first || 'GBP';
  }, [forwarderPackages]);

  const referenceExchangeRate = useMemo(() => {
    const matching = forwarderPackages.find(
      (fp) =>
        fp.shipment.currency === dominantCurrency &&
        fp.shipment.exchangeRate > 0
    );
    return (
      matching?.shipment.exchangeRate ||
      CURRENCY_META[dominantCurrency]?.defaultRate ||
      1
    );
  }, [forwarderPackages, dominantCurrency]);

  const feePresets = useMemo(() => {
    if (!isOpen) {
      return {
        savedGroup: CURRENCY_META[dominantCurrency].defaultGroupOnlyFee,
        savedUnpack: CURRENCY_META[dominantCurrency].defaultUnpackAndRepackFee,
      };
    }
    return loadFeePresetsForCurrency(dominantCurrency);
  }, [dominantCurrency, isOpen]);

  const defaultTierIntlShipping = useMemo(() => {
    return getEstimatedIntlShippingForWeight(
      targetWeightKg,
      dominantCurrency,
      allShipments
    );
  }, [targetWeightKg, dominantCurrency, allShipments]);

  const parsedCustomIntl = parseFloat(customIntlShipping);
  const effectiveIntlOverride =
    customIntlShipping.trim() !== '' && Number.isFinite(parsedCustomIntl)
      ? parsedCustomIntl
      : undefined;

  const report = useMemo(() => {
    return generateConsolidationAdvisorReport(forwarderPackages, {
      targetMaxWeightKg: targetWeightKg,
      includePurchasedInTransit: includePurchased,
      mode,
      currency: dominantCurrency,
      exchangeRate: referenceExchangeRate,
      groupOnlyFeeUnit: feePresets.savedGroup,
      unpackAndRepackFeeUnit: feePresets.savedUnpack,
      estimatedIntlShippingOverride: effectiveIntlOverride,
      estimatedGramsPerDisc: DEFAULT_ESTIMATED_GRAMS_PER_DISC,
      maxResults: 3,
      historicalShipments: allShipments,
    });
  }, [
    forwarderPackages,
    targetWeightKg,
    includePurchased,
    mode,
    dominantCurrency,
    referenceExchangeRate,
    feePresets,
    effectiveIntlOverride,
    allShipments,
  ]);

  if (!isOpen) return null;

  const currSymbol = CURRENCY_META[dominantCurrency]?.symbol || '£';
  const activeUnitFee =
    mode === 'unpack_and_repack'
      ? feePresets.savedUnpack
      : feePresets.savedGroup;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-3 sm:p-5 overflow-y-auto">
      <div className="w-full max-w-4xl rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Cabeçalho */}
        <div className="px-5 py-4 bg-gradient-to-r from-amber-500/15 via-indigo-500/10 to-slate-900 border-b border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5 text-amber-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-white truncate">
                Sugestor Inteligente de Consolidação
              </h2>
              <p className="text-xs text-slate-400 truncate">
                Otimiza a combinação de pacotes pelo menor rateio por CD dentro
                da faixa de peso escolhida
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-950/80 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Corpo com Scroll */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4">
          {/* Painel de Parâmetros e Filtros */}
          <div className="rounded-xl bg-slate-950/80 border border-slate-800/90 p-3.5 sm:p-4 space-y-3.5">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5 items-end">
              {/* 1. Seletor de Meta de Peso */}
              <div className="md:col-span-5 space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Scale className="w-3.5 h-3.5 text-emerald-400" />
                  1. Meta / Limite de Peso da Caixa
                </label>
                <div className="grid grid-cols-4 gap-1.5">
                  {WEIGHT_TIER_OPTIONS.map((tier) => {
                    const isSelected = targetWeightKg === tier.weightKg;
                    return (
                      <button
                        key={tier.weightKg}
                        type="button"
                        onClick={() => {
                          setTargetWeightKg(tier.weightKg);
                          setCustomIntlShipping('');
                        }}
                        className={`rounded-xl border px-2 py-2 text-center transition cursor-pointer ${
                          isSelected
                            ? 'bg-emerald-500/20 border-emerald-400 text-white shadow-sm shadow-emerald-500/20'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                        }`}
                      >
                        <div className="text-xs font-bold font-mono">
                          {tier.weightKg.toFixed(1).replace('.', ',')} kg
                        </div>
                        <div className="text-[10px] opacity-80">
                          {tier.approxCdsLabel}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 2. Modo de Consolidação */}
              <div className="md:col-span-4 space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-amber-400" />
                  2. Modo no Redirecionador
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setMode('unpack_and_repack')}
                    className={`rounded-xl border px-2.5 py-2 text-left transition cursor-pointer ${
                      mode === 'unpack_and_repack'
                        ? 'bg-amber-500/20 border-amber-400 text-white'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="text-xs font-bold flex items-center gap-1">
                      <PackageOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span className="truncate">Desempacotar</span>
                    </div>
                    <div className="text-[10px] font-mono text-amber-300/90">
                      {currSymbol}
                      {feePresets.savedUnpack.toFixed(2)} / pacote
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setMode('group_only')}
                    className={`rounded-xl border px-2.5 py-2 text-left transition cursor-pointer ${
                      mode === 'group_only'
                        ? 'bg-indigo-500/20 border-indigo-400 text-white'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="text-xs font-bold flex items-center gap-1">
                      <PackageCheck className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                      <span className="truncate">Só Agrupar</span>
                    </div>
                    <div className="text-[10px] font-mono text-indigo-300/90">
                      {currSymbol}
                      {feePresets.savedGroup.toFixed(2)} / pacote
                    </div>
                  </button>
                </div>
              </div>

              {/* 3. Frete Internacional Estimado da Faixa */}
              <div className="md:col-span-3 space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">
                  3. Frete Intl. Estimado ({currSymbol})
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-400">
                    {currSymbol}
                  </span>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    placeholder={defaultTierIntlShipping.toFixed(2)}
                    value={customIntlShipping}
                    onChange={(e) => setCustomIntlShipping(e.target.value)}
                    className="w-full rounded-xl bg-slate-900 border border-slate-800 pl-8 pr-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div className="text-[10px] text-slate-500 font-mono">
                  Ref. faixa:{' '}
                  {formatOriginalCurrency(
                    report.estimatedIntlShippingOriginal,
                    dominantCurrency
                  )}{' '}
                  (≈{' '}
                  {formatBrl(
                    report.estimatedIntlShippingOriginal * referenceExchangeRate
                  )}
                  )
                </div>
              </div>
            </div>

            {/* Barra de Toggle: Apenas No Redirecionador vs Incluir Comprados (a caminho) */}
            <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 px-2.5 py-1 text-amber-300 font-medium">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  No Redirecionador: <strong>{report.inForwarderCount}</strong>{' '}
                  pct ({report.inForwarderCds} CDs •{' '}
                  {formatWeightKg(report.inForwarderWeightKg)})
                </span>

                <span className="inline-flex items-center gap-1.5 rounded-lg bg-purple-500/15 border border-purple-500/30 px-2.5 py-1 text-purple-300 font-medium">
                  <span className="w-2 h-2 rounded-full bg-purple-400" />
                  Comprados (a caminho):{' '}
                  <strong>{report.purchasedInTransitCount}</strong> pct (
                  {report.purchasedInTransitCds} CDs • ~
                  {formatWeightKg(report.purchasedInTransitWeightKg)})
                </span>
              </div>

              <button
                type="button"
                onClick={() => setIncludePurchased((prev) => !prev)}
                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                  includePurchased
                    ? 'bg-purple-600/25 border-purple-400 text-purple-200 shadow-sm shadow-purple-500/20'
                    : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-600'
                }`}
              >
                {includePurchased ? (
                  <CheckSquare className="w-4 h-4 text-purple-400" />
                ) : (
                  <div className="w-4 h-4 rounded border border-slate-600" />
                )}
                <span>
                  Incluir &apos;Comprados&apos; na simulação (~
                  {DEFAULT_ESTIMATED_GRAMS_PER_DISC}g/disco s/ peso)
                </span>
              </button>
            </div>
          </div>

          {/* Alerta Inteligente quando só "No Redirecionador" está ativo e ainda sobra espaço na caixa */}
          {!includePurchased &&
            report.purchasedInTransitCount > 0 &&
            report.remainingCapacityInForwarderKg >= 0.15 && (
              <div className="rounded-xl bg-indigo-950/35 border border-indigo-500/40 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-2.5 text-xs text-indigo-200">
                  <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                  <div>
                    <strong>Espaço livre na faixa de {formatWeightKg(targetWeightKg)}:</strong>{' '}
                    Os pacotes já no redirecionador somam{' '}
                    <strong>{formatWeightKg(report.inForwarderWeightKg)}</strong>{' '}
                    (ainda cabem{' '}
                    <strong>
                      +{formatWeightKg(report.remainingCapacityInForwarderKg)}
                    </strong>{' '}
                    ≈ <strong>{report.approxRemainingCdsCapacity} CDs</strong>).
                    Você tem{' '}
                    <strong>
                      {report.purchasedInTransitCount} pacote(s) Comprado(s) (
                      {report.purchasedInTransitCds} CDs)
                    </strong>{' '}
                    a caminho que podem baratear ainda mais o rateio por CD!
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIncludePurchased(true)}
                  className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white transition shrink-0 cursor-pointer"
                >
                  Simular com Comprados
                </button>
              </div>
            )}

          {/* Lista de Sugestões Ranqueadas */}
          {report.suggestions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-800 p-8 text-center space-y-3">
              <Package className="w-10 h-10 text-slate-600 mx-auto" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-300">
                  Menos de 2 pacotes elegíveis para consolidar neste filtro
                </p>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  {!includePurchased && report.purchasedInTransitCount > 0
                    ? `Há apenas ${report.inForwarderCount} pacote no redirecionador agora, mas você possui ${report.purchasedInTransitCount} pacote(s) com status "Comprado". Ative a opção acima para simular a consolidação com eles!`
                    : 'Cadastre pelo menos 2 pacotes com status "No Redirecionador" ou "Comprado" para receber sugestões de consolidação.'}
                </p>
              </div>
              {!includePurchased && report.purchasedInTransitCount > 0 && (
                <button
                  type="button"
                  onClick={() => setIncludePurchased(true)}
                  className="inline-flex items-center gap-2 rounded-xl bg-purple-600 hover:bg-purple-500 px-4 py-2 text-xs font-semibold text-white transition cursor-pointer"
                >
                  <Sparkles className="w-4 h-4" />
                  Incluir {report.purchasedInTransitCount} Pacote(s) Comprado(s)
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3.5">
              {report.suggestions.map((sug) => {
                const isBest = sug.rank === 1 && !sug.exceedsTargetWeight;

                return (
                  <div
                    key={sug.id}
                    className={`rounded-2xl border p-4 transition ${
                      isBest
                        ? 'bg-gradient-to-br from-emerald-950/30 via-slate-900 to-slate-900 border-emerald-500/60 shadow-lg shadow-emerald-950/30'
                        : sug.exceedsTargetWeight
                        ? 'bg-rose-950/15 border-rose-500/40'
                        : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {/* Topo do Card: Badge + Peso + Botões de Ação */}
                    <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
                            isBest
                              ? 'bg-emerald-500 text-slate-950'
                              : sug.exceedsTargetWeight
                              ? 'bg-rose-500/20 border border-rose-500/40 text-rose-300'
                              : 'bg-indigo-500/20 border border-indigo-500/40 text-indigo-300'
                          }`}
                        >
                          {sug.badgeLabel}
                        </span>

                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 border border-slate-800 px-2.5 py-1 text-xs text-slate-200">
                          <Package className="w-3.5 h-3.5 text-amber-400" />
                          <strong>{sug.packageCount}</strong> pacotes
                        </span>

                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 border border-slate-800 px-2.5 py-1 text-xs text-slate-200">
                          <Disc3 className="w-3.5 h-3.5 text-purple-400" />
                          <strong>{sug.totalCds}</strong> CDs
                          {sug.totalPhysicalDiscs > sug.totalCds && (
                            <span className="text-[11px] text-slate-400">
                              ({sug.totalPhysicalDiscs} discos)
                            </span>
                          )}
                        </span>

                        <span
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-mono ${
                            sug.exceedsTargetWeight
                              ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                              : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                          }`}
                        >
                          <Scale className="w-3.5 h-3.5" />
                          <strong>
                            {sug.hasEstimatedWeights ? '~' : ''}
                            {formatWeightKg(sug.totalWeightKg)}
                          </strong>
                          <span className="opacity-75">
                            / {formatWeightKg(targetWeightKg)} (
                            {sug.weightUtilizationPercent}%)
                          </span>
                        </span>

                        {sug.estimatedSavingsVsIndividualBrl > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25 px-2 py-1 text-[11px] font-medium text-emerald-300">
                            <TrendingDown className="w-3 h-3" />
                            Economiza ~
                            {formatBrl(sug.estimatedSavingsVsIndividualBrl)} vs
                            envios avulsos
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            onSelectPackagesInSidebar(sug.packageIds);
                            onClose();
                          }}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 transition cursor-pointer"
                        >
                          <CheckSquare className="w-3.5 h-3.5 text-amber-400" />
                          <span>Marcar na Lista</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => onConsolidateSuggestion(sug)}
                          className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition cursor-pointer ${
                            isBest
                              ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/20'
                              : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                          }`}
                        >
                          <Layers className="w-3.5 h-3.5" />
                          <span>Consolidar Agora</span>
                        </button>
                      </div>
                    </div>

                    {/* Barra Visual de Ocupação de Peso */}
                    <div className="mt-3 space-y-1">
                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span>
                          Ocupação da faixa de peso (
                          {sug.hasEstimatedWeights
                            ? 'inclui pesos estimados ~110g/disco'
                            : '100% pesos reais'}
                          )
                        </span>
                        <span className="font-mono">
                          {sug.exceedsTargetWeight ? (
                            <span className="text-rose-400 inline-flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" /> Excede a
                              meta em{' '}
                              {formatWeightKg(
                                sug.totalWeightKg - targetWeightKg
                              )}
                            </span>
                          ) : sug.remainingWeightKg > 0 ? (
                            <span className="text-slate-300">
                              Folga restante:{' '}
                              <strong>
                                {formatWeightKg(sug.remainingWeightKg)}
                              </strong>
                            </span>
                          ) : (
                            <span className="text-emerald-400 font-semibold">
                              Limite exato atingido (100%)
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-slate-950 border border-slate-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            sug.exceedsTargetWeight
                              ? 'bg-rose-500'
                              : sug.weightUtilizationPercent >= 80
                              ? 'bg-emerald-500'
                              : 'bg-amber-500'
                          }`}
                          style={{
                            width: `${Math.min(
                              100,
                              sug.weightUtilizationPercent
                            )}%`,
                          }}
                        />
                      </div>
                    </div>

                    {/* Métricas Financeiras e Rateio por CD */}
                    <div className="mt-3.5 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      <div className="rounded-xl bg-slate-950/90 border border-emerald-500/30 p-2.5">
                        <div className="text-[10px] uppercase tracking-wider text-slate-400">
                          Rateio Indireto / CD
                        </div>
                        <div className="text-sm sm:text-base font-bold font-mono text-emerald-400 mt-0.5">
                          + {formatBrl(sug.indirectRateioPerCdBrl)}{' '}
                          <span className="text-[10px] font-normal text-slate-400">
                            / CD
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-slate-400">
                          {formatOriginalCurrency(
                            sug.indirectRateioPerCdOriginal,
                            dominantCurrency
                          )}{' '}
                          por CD
                        </div>
                      </div>

                      <div className="rounded-xl bg-slate-950/90 border border-slate-800 p-2.5">
                        <div className="text-[10px] uppercase tracking-wider text-slate-400">
                          Taxa Redir. + Frete Intl.
                        </div>
                        <div className="text-xs sm:text-sm font-bold font-mono text-amber-300 mt-0.5">
                          {formatOriginalCurrency(
                            sug.forwarderFeeOriginal +
                              sug.estimatedIntlShippingOriginal,
                            dominantCurrency
                          )}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400">
                          Taxa {sug.packageCount}x {currSymbol}
                          {activeUnitFee.toFixed(2)} + Frete{' '}
                          {formatOriginalCurrency(
                            sug.estimatedIntlShippingOriginal,
                            dominantCurrency
                          )}
                        </div>
                      </div>

                      <div className="rounded-xl bg-slate-950/90 border border-slate-800 p-2.5">
                        <div className="text-[10px] uppercase tracking-wider text-slate-400">
                          Custo Final Médio / CD
                        </div>
                        <div className="text-xs sm:text-sm font-bold font-mono text-white mt-0.5">
                          {formatBrl(sug.estimatedAvgFinalPerCdBrl)}{' '}
                          <span className="text-[10px] font-normal text-slate-400">
                            (s/ imp.)
                          </span>
                        </div>
                        <div className="text-[10px] font-mono text-rose-300/90">
                          c/ Est. MG:{' '}
                          {formatBrl(
                            (sug.estimatedTotalNoTaxBrl +
                              sug.estimatedTaxMgBrl) /
                              sug.totalCds
                          )}
                        </div>
                      </div>

                      <div className="rounded-xl bg-slate-950/90 border border-slate-800 p-2.5">
                        <div className="text-[10px] uppercase tracking-wider text-slate-400">
                          Total Caixa (CDs + Fretes)
                        </div>
                        <div className="text-xs sm:text-sm font-bold font-mono text-indigo-300 mt-0.5">
                          {formatBrl(sug.estimatedTotalNoTaxBrl)}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400">
                          CDs:{' '}
                          {formatOriginalCurrency(
                            sug.cdsValueOriginal,
                            dominantCurrency
                          )}
                          {sug.inheritedInternalShippingOriginal > 0
                            ? ` • Local: ${formatOriginalCurrency(
                                sug.inheritedInternalShippingOriginal,
                                dominantCurrency
                              )}`
                            : ''}
                        </div>
                      </div>
                    </div>

                    {/* Lista de Pacotes que compõem a combinação */}
                    <div className="mt-3 pt-2.5 border-t border-slate-800/60">
                      <div className="text-[11px] font-semibold text-slate-400 mb-2">
                        Pacotes incluídos nesta combinação ({sug.packageCount}):
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {sug.packages.map((pkg) => (
                          <div
                            key={pkg.shipmentId}
                            className="flex items-center justify-between gap-2 rounded-lg bg-slate-900/90 border border-slate-800/90 px-2.5 py-1.5 text-xs"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                title={
                                  pkg.status === 'no_redirecionador'
                                    ? 'No Redirecionador'
                                    : 'Comprado (a caminho)'
                                }
                                className={`w-2 h-2 rounded-full shrink-0 ${
                                  pkg.status === 'no_redirecionador'
                                    ? 'bg-amber-400'
                                    : 'bg-purple-400'
                                }`}
                              />
                              <span className="font-medium text-slate-200 truncate">
                                {pkg.name}
                              </span>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0 font-mono text-[11px]">
                              <span className="rounded bg-purple-500/15 border border-purple-500/30 px-1.5 py-0.5 text-purple-300">
                                {pkg.cdCount}{' '}
                                {pkg.cdCount === 1 ? 'CD' : 'CDs'}
                              </span>
                              <span
                                title={
                                  pkg.isWeightEstimated
                                    ? `Peso estimado automaticamente (${pkg.physicalDiscCount} disco(s) × ${DEFAULT_ESTIMATED_GRAMS_PER_DISC}g)`
                                    : 'Peso real cadastrado no pacote'
                                }
                                className={`rounded px-1.5 py-0.5 border ${
                                  pkg.isWeightEstimated
                                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                                    : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                                }`}
                              >
                                {pkg.isWeightEstimated ? '~' : ''}
                                {formatWeightKg(pkg.weightKg)}
                                {pkg.isWeightEstimated ? ' est.' : ''}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Rodapé */}
        <div className="px-5 py-3 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400" /> No
              Redirecionador
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-purple-400" /> Comprado (a
              caminho)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="text-amber-300 font-mono">~kg est.</span> = Peso
              estimado ({DEFAULT_ESTIMATED_GRAMS_PER_DISC}g/disco)
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-slate-800 hover:bg-slate-700 px-4 py-1.5 text-xs font-semibold text-white transition cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
