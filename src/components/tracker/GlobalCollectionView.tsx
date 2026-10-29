import React from 'react';
import {
  CalculatedCDItem,
  Shipment,
  ShipmentStatus,
} from '@/types/tracker';
import {
  formatBrl,
  formatOriginalCurrency,
  formatWeightKg,
} from '@/lib/calculations';
import { AlbumCover } from '@/components/AlbumCover';
import { STATUS_LABELS } from '@/components/ShipmentModal';
import { ArrowUpDown, Disc3, Package, Scale, Search } from 'lucide-react';

export interface CollectionEntry {
  item: CalculatedCDItem;
  shipment: Shipment;
}

interface GlobalCollectionViewProps {
  entries: CollectionEntry[];
  totalCollectionCount: number;
  searchQuery: string;
  onSearchChange: (val: string) => void;
  statusFilter: ShipmentStatus | 'ALL';
  onStatusFilterChange: (val: ShipmentStatus | 'ALL') => void;
  sortBy: 'artist' | 'album' | 'cost_asc' | 'cost_desc' | 'recent';
  onSortByChange: (
    val: 'artist' | 'album' | 'cost_asc' | 'cost_desc' | 'recent'
  ) => void;
  onNavigateToPackage: (shipmentId: string) => void;
}

export function GlobalCollectionView({
  entries,
  totalCollectionCount,
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  sortBy,
  onSortByChange,
  onNavigateToPackage,
}: GlobalCollectionViewProps) {
  return (
    <main className="flex-1 max-w-[1600px] w-full mx-auto px-3.5 sm:px-6 py-4 sm:py-6 space-y-4">
      <div className="rounded-2xl bg-slate-900/60 border border-slate-800/90 p-4 sm:p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
              <Disc3 className="w-5 h-5 text-purple-400" />
              Minha Coleção Completa ({entries.length} de {totalCollectionCount} CDs)
            </h2>
            <p className="text-xs text-slate-400">
              Consulte e compare todos os CDs importados entre todos os seus pacotes.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 sm:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Filtrar por artista ou álbum..."
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                className="w-full rounded-xl bg-slate-950 border border-slate-800 pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:border-purple-500 focus:outline-none"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) =>
                onStatusFilterChange(e.target.value as ShipmentStatus | 'ALL')
              }
              className="rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-slate-200 focus:border-purple-500 focus:outline-none"
            >
              <option value="ALL">Todos os Status</option>
              {(Object.keys(STATUS_LABELS) as ShipmentStatus[]).map((st) => (
                <option key={st} value={st}>
                  {STATUS_LABELS[st].label}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1.5 rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-slate-300">
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <select
                value={sortBy}
                onChange={(e) =>
                  onSortByChange(
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

        {entries.length === 0 ? (
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
              {entries.map(({ item, shipment }) => {
                const statusInfo = STATUS_LABELS[shipment.status];
                return (
                  <div
                    key={item.id}
                    className="rounded-xl bg-slate-950/75 border border-slate-800/90 p-3 space-y-2"
                  >
                    <div className="flex items-start gap-3">
                      <div className="h-14 w-14 rounded-xl bg-slate-900 border border-slate-700/80 flex items-center justify-center overflow-hidden shrink-0">
                        <AlbumCover
                          src={item.coverUrl}
                          alt={item.albumTitle}
                          iconClassName="w-6 h-6 text-slate-600"
                        />
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
                            onClick={() => onNavigateToPackage(shipment.id)}
                            className="inline-flex items-center gap-1 rounded bg-slate-800 hover:bg-slate-700 px-1.5 py-0.5 text-[10px] text-indigo-300 truncate max-w-[180px]"
                          >
                            <Package className="w-2.5 h-2.5 shrink-0" />
                            <span className="truncate">{shipment.name}</span>
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
                    <th className="py-3 px-4 text-right">Custo Final (BRL)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 text-sm">
                  {entries.map(({ item, shipment }) => {
                    const statusInfo = STATUS_LABELS[shipment.status];
                    return (
                      <tr
                        key={item.id}
                        className="bg-slate-950/40 hover:bg-slate-900/80 transition"
                      >
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3">
                            <div className="h-11 w-11 rounded-lg bg-slate-900 border border-slate-700/80 flex items-center justify-center overflow-hidden shrink-0">
                              <AlbumCover
                                src={item.coverUrl}
                                alt={item.albumTitle}
                                iconClassName="w-5 h-5 text-slate-600"
                              />
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
                              onClick={() => onNavigateToPackage(shipment.id)}
                              title="Abrir detalhes deste pacote"
                              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 px-2.5 py-1 text-xs font-medium text-indigo-300 transition max-w-[260px] truncate"
                            >
                              <Package className="w-3.5 h-3.5 shrink-0" />
                              <span className="truncate">{shipment.name}</span>
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
  );
}
