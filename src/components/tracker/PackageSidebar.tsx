'use client';

import React from 'react';
import {
  Package,
  X,
  Layers,
  Plus,
  Search,
  CheckSquare,
  Square,
  Lock,
  Disc3,
  Scale,
  ExternalLink,
  ChevronRight,
} from 'lucide-react';
import { Shipment, ShipmentStatus, ShipmentSummary } from '@/types/tracker';
import { STATUS_LABELS } from '@/components/ShipmentModal';
import { formatBrl, formatWeightKg } from '@/lib/formatters';

interface PackageSidebarProps {
  mobileActivePane: 'list' | 'detail';
  filteredShipments: Shipment[];
  totalShipmentsCount: number;
  checkedConsolidationStats: { packageCount: number; totalCds: number };
  onClearCheckedPackages: () => void;
  onOpenConsolidateFromChecked: () => void;
  onOpenNewShipmentModal: () => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  statusFilter: ShipmentStatus | 'ALL';
  onStatusFilterChange: (status: ShipmentStatus | 'ALL') => void;
  summariesMap: Map<string, ShipmentSummary>;
  selectedShipmentId: string | null;
  forwarderPackageIdsSet: Set<string>;
  checkedPackageIds: Set<string>;
  onToggleCheckPackage: (e: React.MouseEvent, shipId: string) => void;
  onSelectShipment: (shipId: string) => void;
}

export const PackageSidebar: React.FC<PackageSidebarProps> = ({
  mobileActivePane,
  filteredShipments,
  totalShipmentsCount,
  checkedConsolidationStats,
  onClearCheckedPackages,
  onOpenConsolidateFromChecked,
  onOpenNewShipmentModal,
  searchQuery,
  onSearchQueryChange,
  statusFilter,
  onStatusFilterChange,
  summariesMap,
  selectedShipmentId,
  forwarderPackageIdsSet,
  checkedPackageIds,
  onToggleCheckPackage,
  onSelectShipment,
}) => {
  return (
    <section
      className={`${
        mobileActivePane === 'detail' ? 'hidden lg:flex' : 'flex'
      } lg:col-span-4 xl:col-span-4 flex-col gap-3.5 bg-slate-900/60 border border-slate-800/90 rounded-2xl p-4 lg:sticky lg:top-24`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200 flex items-center gap-2">
            <Package className="w-4 h-4 text-indigo-400" />
            Pacotes / Lotes ({filteredShipments.length})
          </h2>
          <p className="text-[11px] text-slate-400">
            {checkedConsolidationStats.packageCount > 0
              ? `${checkedConsolidationStats.packageCount} ${
                  checkedConsolidationStats.packageCount === 1
                    ? 'pacote marcado'
                    : 'pacotes marcados'
                } (${checkedConsolidationStats.totalCds} CDs)`
              : 'Marque 2+ pacotes para consolidar ou toque para abrir'}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {checkedConsolidationStats.packageCount > 0 && (
            <button
              type="button"
              onClick={onClearCheckedPackages}
              title="Limpar seleção de pacotes"
              className="p-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white transition"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={onOpenConsolidateFromChecked}
            disabled={checkedConsolidationStats.packageCount < 2}
            title={
              checkedConsolidationStats.packageCount >= 2
                ? `Consolidar ${checkedConsolidationStats.packageCount} pacotes selecionados (${checkedConsolidationStats.totalCds} CDs)`
                : 'Marque pelo menos 2 pacotes disponíveis nos checkboxes abaixo para habilitar a consolidação'
            }
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition shrink-0 ${
              checkedConsolidationStats.packageCount >= 2
                ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/25 cursor-pointer'
                : 'bg-slate-950 border border-slate-800 text-slate-500 opacity-60 cursor-not-allowed'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>
              Consolidar
              {checkedConsolidationStats.packageCount > 0
                ? ` (${checkedConsolidationStats.packageCount})`
                : ''}
            </span>
          </button>

          <button
            onClick={onOpenNewShipmentModal}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-indigo-600/25 transition shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Novo Pacote
          </button>
        </div>
      </div>

      {/* Barra de Busca Global e Filtro por Status */}
      <div className="space-y-2.5">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar pacote, artista, álbum ou rastreio..."
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            className="w-full rounded-xl bg-slate-950 border border-slate-800 pl-9 pr-3 py-2 text-sm sm:text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          <button
            onClick={() => onStatusFilterChange('ALL')}
            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition shrink-0 ${
              statusFilter === 'ALL'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            Todos ({totalShipmentsCount})
          </button>
          {(Object.keys(STATUS_LABELS) as ShipmentStatus[]).map((st) => (
            <button
              key={st}
              onClick={() => onStatusFilterChange(st)}
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

      {/* Lista Enxuta de Pacotes */}
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
            const isEligibleForConsolidation = forwarderPackageIdsSet.has(
              ship.id
            );
            const isCheckedForConsolidation = checkedPackageIds.has(ship.id);

            return (
              <div
                key={ship.id}
                onClick={() => onSelectShipment(ship.id)}
                className={`group cursor-pointer rounded-xl border p-3.5 transition-all ${
                  isCheckedForConsolidation
                    ? 'bg-amber-950/30 border-amber-500/70 shadow-md shadow-amber-950/30'
                    : isSelected
                    ? 'bg-indigo-950/45 border-indigo-500/80 shadow-md shadow-indigo-950/40'
                    : 'bg-slate-950/70 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900/60'
                }`}
              >
                {/* Linha 1: Checkbox (se elegível) + Nome + Status Badge */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {isEligibleForConsolidation && (
                      <button
                        type="button"
                        onClick={(e) => onToggleCheckPackage(e, ship.id)}
                        title={
                          isCheckedForConsolidation
                            ? 'Desmarcar da consolidação'
                            : 'Marcar pacote para consolidar'
                        }
                        className="p-0.5 rounded text-slate-400 hover:text-amber-300 transition shrink-0 cursor-pointer"
                      >
                        {isCheckedForConsolidation ? (
                          <CheckSquare className="w-4 h-4 text-amber-400" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-500 group-hover:text-slate-300" />
                        )}
                      </button>
                    )}

                    <h3 className="text-sm font-semibold text-white truncate flex items-center gap-1.5 min-w-0">
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
                  </div>

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
                      {(summary?.totalItemsCount || 0) === 1 ? 'CD' : 'CDs'}
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

                    {(ship.ebayOrderUrl || ship.ebayOrderId) && (
                      <a
                        href={
                          ship.ebayOrderUrl ||
                          `https://order.ebay.com/ord/show?orderId=${ship.ebayOrderId}`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title="Abrir pedido original no eBay"
                        className="inline-flex items-center gap-1 rounded bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 px-1.5 py-0.5 text-[10px] font-mono text-sky-300 transition"
                      >
                        <span>
                          {ship.ebayOrderId
                            ? `#${ship.ebayOrderId}`
                            : 'Pedido eBay'}
                        </span>
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
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
  );
};
