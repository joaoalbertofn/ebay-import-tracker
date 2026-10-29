'use client';

import React from 'react';
import {
  PackageOpen,
  ChevronDown,
  ChevronUp,
  CheckSquare,
  Square,
  RotateCcw,
  Trash2,
  PackageCheck,
} from 'lucide-react';
import { CurrencyCode } from '@/types/tracker';
import { ForwarderPackageOption } from '@/components/ShipmentModal';
import { formatBrl, formatOriginalCurrency } from '@/lib/formatters';

interface ForwarderConsolidationSectionProps {
  eligibleForwarderPackages: ForwarderPackageOption[];
  showForwarderBox: boolean;
  isForwarderExpandedManual: boolean;
  setIsForwarderExpandedManual: (expanded: boolean) => void;
  selectedExistingCdIds: Set<string>;
  discardedExistingCdIds: Set<string>;
  areAllForwarderSelected: boolean;
  allForwarderCdIdsLength: number;
  isAlreadyShippedStatus: boolean;
  currency: CurrencyCode;
  currSymbol: string;
  selectedSourceShipmentsCount: number;
  selectedForwarderCdsValueInTargetCurr: number;
  inheritedInternalShippingFromSelected: number;
  forwarderFee: string;
  parsedRate: number;
  consolidationAction: 'group_only' | 'unpack_and_repack';
  groupOnlyFeePreset: string;
  unpackAndRepackFeePreset: string;
  onSelectAllForwarderPackages: () => void;
  onToggleWholeForwarderPackage: (fp: ForwarderPackageOption) => void;
  onToggleSingleForwarderCd: (cdId: string) => void;
  onToggleDiscardForwarderCd: (cdId: string) => void;
  onSelectConsolidationAction: (
    action: 'group_only' | 'unpack_and_repack',
    unitFee: number
  ) => void;
  onChangeGroupOnlyPreset: (preset: string) => void;
  onChangeUnpackAndRepackPreset: (preset: string) => void;
}

export const ForwarderConsolidationSection: React.FC<
  ForwarderConsolidationSectionProps
> = ({
  eligibleForwarderPackages,
  showForwarderBox,
  setIsForwarderExpandedManual,
  selectedExistingCdIds,
  discardedExistingCdIds,
  areAllForwarderSelected,
  allForwarderCdIdsLength,
  isAlreadyShippedStatus,
  currency,
  currSymbol,
  selectedSourceShipmentsCount,
  selectedForwarderCdsValueInTargetCurr,
  inheritedInternalShippingFromSelected,
  forwarderFee,
  parsedRate,
  consolidationAction,
  groupOnlyFeePreset,
  unpackAndRepackFeePreset,
  onSelectAllForwarderPackages,
  onToggleWholeForwarderPackage,
  onToggleSingleForwarderCd,
  onToggleDiscardForwarderCd,
  onSelectConsolidationAction,
  onChangeGroupOnlyPreset,
  onChangeUnpackAndRepackPreset,
}) => {
  return (
    <>
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
                <strong className="text-rose-300">lixeira (🗑️)</strong> para
                descartar um CD no redirecionador (redistribuindo seu custo
                entre os CDs mantidos).
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onSelectAllForwarderPackages}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-amber-500/40 px-2.5 py-1.5 text-xs font-medium text-amber-300 transition"
              >
                {areAllForwarderSelected ? (
                  <>
                    <CheckSquare className="w-3.5 h-3.5" /> Desmarcar Todos
                  </>
                ) : (
                  <>
                    <Square className="w-3.5 h-3.5" /> Selecionar Todos (
                    {allForwarderCdIdsLength} CDs)
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
                selectedInPkg > 0 && selectedInPkg < nonDiscardedInPkg.length;

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
                      onClick={() => onToggleWholeForwarderPackage(fp)}
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
                      const isCdChecked = selectedExistingCdIds.has(cd.id);
                      const isCdDiscarded = discardedExistingCdIds.has(cd.id);
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
                            onClick={() => onToggleSingleForwarderCd(cd.id)}
                            className="flex items-center justify-between gap-2 flex-1 min-w-0 text-left"
                          >
                            <span
                              className={`truncate ${
                                isCdDiscarded ? 'line-through' : ''
                              }`}
                            >
                              {isCdChecked ? '✓ ' : ''}
                              <strong>{cd.artist}</strong> — {cd.albumTitle}
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
                            onClick={() => onToggleDiscardForwarderCd(cd.id)}
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
                serão excluídos ao salvar e seu valor pago + frete local serão
                redistribuídos automaticamente entre os CDs mantidos do mesmo
                lote.
              </span>
            </div>
          )}

          {selectedExistingCdIds.size > 0 && (
            <div className="pt-2 border-t border-amber-500/30 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-950/90 border border-amber-500/35 px-3.5 py-2.5 text-xs">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-300">
                  <span>
                    <strong>{selectedSourceShipmentsCount}</strong>{' '}
                    {selectedSourceShipmentsCount === 1 ? 'pacote' : 'pacotes'}{' '}
                    • <strong>{selectedExistingCdIds.size}</strong>{' '}
                    {selectedExistingCdIds.size === 1 ? 'CD' : 'CDs'}
                  </span>
                  <span>
                    • CDs:{' '}
                    <strong className="font-mono text-amber-300">
                      {formatOriginalCurrency(
                        selectedForwarderCdsValueInTargetCurr,
                        currency
                      )}
                    </strong>
                  </span>
                  {inheritedInternalShippingFromSelected > 0 && (
                    <span>
                      • Frete Local:{' '}
                      <strong className="font-mono text-sky-300">
                        {formatOriginalCurrency(
                          inheritedInternalShippingFromSelected,
                          currency
                        )}
                      </strong>
                    </span>
                  )}
                </div>
                <span className="font-mono text-emerald-400 font-semibold">
                  Subtotal Consolidado: ≈{' '}
                  {formatBrl(
                    (selectedForwarderCdsValueInTargetCurr +
                      inheritedInternalShippingFromSelected +
                      (parseFloat(forwarderFee) || 0)) *
                      parsedRate
                  )}
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-amber-200">
                  Modo de consolidação no redirecionador (
                  {selectedExistingCdIds.size}{' '}
                  {selectedExistingCdIds.size === 1
                    ? 'CD selecionado'
                    : 'CDs selecionados'}{' '}
                  de {selectedSourceShipmentsCount}{' '}
                  {selectedSourceShipmentsCount === 1 ? 'pacote' : 'pacotes'}
                  ):
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div
                  onClick={() =>
                    onSelectConsolidationAction(
                      'group_only',
                      parseFloat(groupOnlyFeePreset) || 0
                    )
                  }
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
                      Por pacote ({selectedSourceShipmentsCount}x = {currSymbol}
                      {(
                        Math.max(1, selectedSourceShipmentsCount) *
                        (parseFloat(groupOnlyFeePreset) || 0)
                      ).toFixed(2)}
                      )
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
                      onChange={(e) => onChangeGroupOnlyPreset(e.target.value)}
                      title="Taxa por pacote (ex: £2.40 c/ VAT)"
                      className="w-16 rounded-lg bg-slate-900 border border-slate-700 px-2 py-1 text-xs font-mono text-white text-right"
                    />
                  </div>
                </div>

                <div
                  onClick={() =>
                    onSelectConsolidationAction(
                      'unpack_and_repack',
                      parseFloat(unpackAndRepackFeePreset) || 0
                    )
                  }
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
                      Por pacote ({selectedSourceShipmentsCount}x = {currSymbol}
                      {(
                        Math.max(1, selectedSourceShipmentsCount) *
                        (parseFloat(unpackAndRepackFeePreset) || 0)
                      ).toFixed(2)}
                      )
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
                      onChange={(e) =>
                        onChangeUnpackAndRepackPreset(e.target.value)
                      }
                      title="Taxa por pacote (ex: £3.60 c/ VAT)"
                      className="w-16 rounded-lg bg-slate-900 border border-slate-700 px-2 py-1 text-xs font-mono text-white text-right"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
};
