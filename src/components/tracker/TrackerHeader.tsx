import React, { useEffect, useRef, useState } from 'react';
import { UserButton } from '@clerk/nextjs';
import {
  Cloud,
  CloudOff,
  Database,
  Disc3,
  Download,
  FileText,
  Flame,
  Globe,
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
  packageWorkspaceViewMode: 'list' | 'map';
  setPackageWorkspaceViewMode: (mode: 'list' | 'map') => void;
  packagesCount: number;
  onOpenReportModal: () => void;
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
  packageWorkspaceViewMode,
  setPackageWorkspaceViewMode,
  packagesCount,
  onOpenReportModal,
  onForceSync,
  onExportBackup,
  fileInputRef,
  onImportBackup,
  user,
}: TrackerHeaderProps) {
  const [isBackupMenuOpen, setIsBackupMenuOpen] = useState(false);
  const backupMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isBackupMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        backupMenuRef.current &&
        !backupMenuRef.current.contains(e.target as Node)
      ) {
        setIsBackupMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isBackupMenuOpen]);

  const isPackagesListActive =
    activeModule === 'tracker' &&
    activeMainTab === 'packages' &&
    packageWorkspaceViewMode === 'list';
  const isPackagesMapActive =
    activeModule === 'tracker' &&
    activeMainTab === 'packages' &&
    packageWorkspaceViewMode === 'map';
  const isCollectionActive =
    activeModule === 'tracker' && activeMainTab === 'collection';
  const isRadarActive = activeModule === 'radar';

  return (
    <header className="border-b border-slate-800/80 bg-slate-900/85 backdrop-blur-md sticky top-0 z-30">
      <div className="max-w-[1600px] mx-auto px-3 sm:px-5 py-1.5 flex flex-wrap items-center justify-between gap-2">
        {/* Esquerda: Brand Compacta + Navegação Unificada (Pacotes | Mapa | Coleção | Radar) */}
        <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-sm shadow-indigo-500/20 shrink-0">
              <Disc3 className="w-4 h-4 text-white" />
            </div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight text-white truncate">
              CD Import Tracker
            </h1>
          </div>

          <div className="hidden sm:block h-4 w-px bg-slate-800" />

          {/* Barra Única de Navegação Global */}
          <nav
            aria-label="Navegação Principal"
            className="inline-flex items-center gap-1 p-0.5 rounded-lg bg-slate-950/90 border border-slate-800 overflow-x-auto no-scrollbar"
          >
            <button
              type="button"
              onClick={() => {
                setActiveModule('tracker');
                setActiveMainTab('packages');
                setPackageWorkspaceViewMode('list');
              }}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                isPackagesListActive
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Package className="w-3.5 h-3.5" />
              <span>Pacotes ({packagesCount})</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveModule('tracker');
                setActiveMainTab('packages');
                setPackageWorkspaceViewMode('map');
              }}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                isPackagesMapActive
                  ? 'bg-sky-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Mapa</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveModule('tracker');
                setActiveMainTab('collection');
              }}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                isCollectionActive
                  ? 'bg-purple-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Disc3 className="w-3.5 h-3.5" />
              <span>
                Coleção ({globalStats.totalItems})
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveModule('radar')}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                isRadarActive
                  ? 'bg-amber-500 text-slate-950 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Flame
                className={`w-3.5 h-3.5 ${
                  isRadarActive ? 'text-slate-950' : 'text-amber-400'
                }`}
              />
              <span>Radar</span>
            </button>
          </nav>
        </div>

        {/* Direita: Global KPIs Inline + Cloud Sync + Relatório + Menu Backup + Usuário */}
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          <div className="hidden xl:flex items-center gap-3.5 rounded-lg bg-slate-950/90 border border-slate-800 px-3 py-1 text-[11px]">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Investido:</span>
              <span className="font-mono font-bold text-white text-xs">
                {formatBrl(globalStats.totalInvestedBrl)}
              </span>
            </div>
            <div className="h-3.5 w-px bg-slate-800" />
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Álbuns:</span>
              <span className="font-mono font-bold text-indigo-300 text-xs">
                {globalStats.totalItems}{' '}
                <span className="text-[10px] font-normal text-slate-400">
                  ({globalStats.totalPhysicalDiscs} discos)
                </span>
              </span>
            </div>
            <div className="h-3.5 w-px bg-slate-800" />
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Média/CD:</span>
              <span className="font-mono font-bold text-emerald-400 text-xs">
                {formatBrl(globalStats.avgPerItemBrl)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Indicador Visual de Status do Cloud Sync */}
            {cloudSyncStatus === 'saving' && (
              <span
                title="Sincronizando alterações com a nuvem..."
                className="inline-flex items-center gap-1 rounded-lg bg-amber-500/10 border border-amber-500/30 px-2 py-1 text-[11px] font-medium text-amber-300"
              >
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                <span className="hidden 2xl:inline">Salvando...</span>
              </span>
            )}
            {cloudSyncStatus === 'synced' && (
              <span
                title="Todos os dados estão salvos e sincronizados na nuvem"
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-2 py-1 text-[11px] font-medium text-emerald-300"
              >
                <Cloud className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden 2xl:inline">Sincronizado</span>
              </span>
            )}
            {cloudSyncStatus === 'error' && (
              <button
                type="button"
                onClick={onForceSync}
                title="Falha ao sincronizar com a nuvem. Clique para tentar novamente."
                className="inline-flex items-center gap-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 px-2 py-1 text-[11px] font-medium text-rose-300 transition"
              >
                <CloudOff className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden 2xl:inline">Reenviar Sync</span>
              </button>
            )}

            <button
              type="button"
              onClick={onOpenReportModal}
              title="Gerar relatório de fechamento de custos e impressão/PDF"
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600/90 hover:bg-indigo-600 border border-indigo-500/50 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm shadow-indigo-500/20 transition cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Relatório</span>
            </button>

            {/* Menu Compacto de Backup (Exportar / Importar JSON) */}
            <div ref={backupMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setIsBackupMenuOpen((prev) => !prev)}
                title="Backup de dados (Exportar ou Importar JSON)"
                className="inline-flex items-center gap-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 px-2 py-1 text-[11px] font-medium text-slate-200 transition cursor-pointer"
              >
                <Database className="w-3.5 h-3.5 text-indigo-400" />
                <span className="hidden lg:inline">Backup</span>
              </button>

              {isBackupMenuOpen && (
                <div className="absolute right-0 mt-1.5 w-48 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl py-1.5 z-50 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setIsBackupMenuOpen(false);
                      onExportBackup();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-slate-200 hover:bg-slate-800 transition cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    <span>Exportar Backup (.json)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsBackupMenuOpen(false);
                      fileInputRef.current?.click();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-slate-200 hover:bg-slate-800 transition cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                    <span>Importar Backup (.json)</span>
                  </button>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                onChange={onImportBackup}
                className="hidden"
              />
            </div>

            <div className="flex items-center gap-1.5 pl-1.5 border-l border-slate-800">
              <span className="hidden 2xl:inline text-xs text-slate-400 max-w-[110px] truncate">
                {user?.firstName || user?.primaryEmailAddress?.emailAddress}
              </span>
              <UserButton />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
