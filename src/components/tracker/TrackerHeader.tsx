import React from 'react';
import { UserButton } from '@clerk/nextjs';
import {
  Cloud,
  CloudOff,
  Disc3,
  Download,
  Flame,
  Loader2,
  Package,
  Upload,
} from 'lucide-react';
import { formatBrl } from '@/lib/calculations';

export interface GlobalStats {
  totalInvestedBrl: number;
  totalItems: number;
  totalPhysicalDiscs: number;
  avgPerItemBrl: number;
}

interface TrackerHeaderProps {
  globalStats: GlobalStats;
  cloudSyncStatus: 'synced' | 'saving' | 'error';
  activeModule: 'tracker' | 'radar';
  setActiveModule: (mod: 'tracker' | 'radar') => void;
  activeMainTab: 'packages' | 'collection';
  setActiveMainTab: (tab: 'packages' | 'collection') => void;
  packagesCount: number;
  onForceSync: () => void;
  onExportBackup: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onImportBackup: (e: React.ChangeEvent<HTMLInputElement>) => void;
  user?: {
    firstName?: string | null;
    primaryEmailAddress?: { emailAddress?: string | null } | null;
  } | null;
}

export function TrackerHeader({
  globalStats,
  cloudSyncStatus,
  activeModule,
  setActiveModule,
  activeMainTab,
  setActiveMainTab,
  packagesCount,
  onForceSync,
  onExportBackup,
  fileInputRef,
  onImportBackup,
  user,
}: TrackerHeaderProps) {
  return (
    <header className="border-b border-slate-800/80 bg-slate-900/80 backdrop-blur-md sticky top-0 z-30">
      <div className="max-w-[1600px] mx-auto px-3.5 sm:px-6 py-3 flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-3">
          {/* Brand */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 shrink-0">
              <Disc3 className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold tracking-tight text-white truncate">
                  CD Import Tracker
                </h1>
                <span className="hidden sm:inline-flex rounded-full bg-indigo-500/15 border border-indigo-500/30 px-2 py-0.5 text-[11px] font-medium text-indigo-300">
                  SPA Dashboard
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-400 truncate">
                Compras no eBay, redirecionadores e rateio alfandegário em BRL
              </p>
            </div>
          </div>

          {/* Global KPIs (Desktop) + Cloud Sync Status + Backup Actions */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="hidden lg:flex items-center gap-5 rounded-xl bg-slate-950/90 border border-slate-800 px-4 py-2 text-xs">
              <div>
                <span className="text-slate-400 block">Total Investido</span>
                <span className="font-mono font-bold text-white text-sm">
                  {formatBrl(globalStats.totalInvestedBrl)}
                </span>
              </div>
              <div className="h-6 w-px bg-slate-800" />
              <div>
                <span className="text-slate-400 block">Álbuns / Box Sets</span>
                <span className="font-mono font-bold text-indigo-300 text-sm">
                  {globalStats.totalItems}{' '}
                  <span className="text-[11px] font-normal text-slate-400">
                    ({globalStats.totalPhysicalDiscs} discos)
                  </span>
                </span>
              </div>
              <div className="h-6 w-px bg-slate-800" />
              <div>
                <span className="text-slate-400 block">Média Real / CD</span>
                <span className="font-mono font-bold text-emerald-400 text-sm">
                  {formatBrl(globalStats.avgPerItemBrl)}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2">
              {/* Indicador Visual de Status do Cloud Sync */}
              {cloudSyncStatus === 'saving' && (
                <span
                  title="Sincronizando alterações com a nuvem..."
                  className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 px-2.5 py-2 text-[11px] font-medium text-amber-300"
                >
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  <span className="hidden md:inline">Salvando...</span>
                </span>
              )}
              {cloudSyncStatus === 'synced' && (
                <span
                  title="Todos os dados estão salvos e sincronizados na nuvem"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-2 text-[11px] font-medium text-emerald-300"
                >
                  <Cloud className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden md:inline">Sincronizado</span>
                </span>
              )}
              {cloudSyncStatus === 'error' && (
                <button
                  type="button"
                  onClick={onForceSync}
                  title="Falha ao sincronizar com a nuvem. Clique para tentar novamente."
                  className="inline-flex items-center gap-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 px-2.5 py-2 text-[11px] font-medium text-rose-300 transition"
                >
                  <CloudOff className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden md:inline">Reenviar Sync</span>
                </button>
              )}

              <button
                onClick={onExportBackup}
                title="Exportar seus dados em arquivo JSON"
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 px-2.5 sm:px-3 py-2 text-xs font-medium text-slate-200 transition"
              >
                <Download className="w-3.5 h-3.5 text-indigo-400" />
                <span className="hidden sm:inline">Exportar Backup</span>
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                title="Importar backup JSON salvo anteriormente"
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 px-2.5 sm:px-3 py-2 text-xs font-medium text-slate-200 transition"
              >
                <Upload className="w-3.5 h-3.5 text-purple-400" />
                <span className="hidden sm:inline">Importar</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                onChange={onImportBackup}
                className="hidden"
              />

              <div className="flex items-center gap-2 pl-1.5 sm:pl-2 border-l border-slate-800">
                <span className="hidden xl:inline text-xs text-slate-400 max-w-[140px] truncate">
                  {user?.firstName || user?.primaryEmailAddress?.emailAddress}
                </span>
                <UserButton />
              </div>
            </div>
          </div>
        </div>

        {/* KPI Strip Compacta para Mobile/Tablet (< lg) */}
        <div className="grid grid-cols-3 gap-2 lg:hidden rounded-xl bg-slate-950/90 border border-slate-800/90 px-3 py-2 text-[11px]">
          <div>
            <span className="text-slate-400 block truncate">Total Investido</span>
            <span className="font-mono font-bold text-white text-xs sm:text-sm">
              {formatBrl(globalStats.totalInvestedBrl)}
            </span>
          </div>
          <div className="border-x border-slate-800 px-2">
            <span className="text-slate-400 block truncate">Álbuns (Discos)</span>
            <span className="font-mono font-bold text-indigo-300 text-xs sm:text-sm">
              {globalStats.totalItems}{' '}
              <span className="text-[10px] font-normal text-slate-400">
                ({globalStats.totalPhysicalDiscs})
              </span>
            </span>
          </div>
          <div className="pl-1">
            <span className="text-slate-400 block truncate">Média Real / CD</span>
            <span className="font-mono font-bold text-emerald-400 text-xs sm:text-sm">
              {formatBrl(globalStats.avgPerItemBrl)}
            </span>
          </div>
        </div>

        {/* ABAS DE NAVEGAÇÃO PRINCIPAL (E SELETOR MOBILE DE MÓDULO) */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/60">
          {/* Seletor Mobile entre Rastreamento e Radar Top 100 */}
          <div className="flex md:hidden items-center gap-1.5 p-1 rounded-xl bg-slate-950/90 border border-slate-800 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setActiveModule('tracker')}
              className={`flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                activeModule === 'tracker'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Package className="w-3.5 h-3.5" />
              <span>Rastreamento</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveModule('radar')}
              className={`flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                activeModule === 'radar'
                  ? 'bg-amber-500 text-slate-950 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Flame className="w-3.5 h-3.5" />
              <span>Radar Top 100</span>
            </button>
          </div>

          {activeModule === 'tracker' && (
            <div className="inline-flex items-center gap-1.5 p-1 rounded-xl bg-slate-950/90 border border-slate-800">
              <button
                type="button"
                onClick={() => setActiveMainTab('packages')}
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                  activeMainTab === 'packages'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Package className="w-3.5 h-3.5" />
                <span>Visão por Pacotes ({packagesCount})</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveMainTab('collection')}
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                  activeMainTab === 'collection'
                    ? 'bg-purple-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Disc3 className="w-3.5 h-3.5" />
                <span>Todos os CDs da Coleção ({globalStats.totalItems})</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
