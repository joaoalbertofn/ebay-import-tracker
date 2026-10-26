'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BrazilMarketVerdict,
  DemandFormat,
  DemandSortMode,
  MercadoLivreOfferSummary,
  ROCK_METAL_SUBGENRES,
  TopAlbumItem,
} from '@/types/demand';
import { formatBrl } from '@/lib/calculations';
import {
  CheckCircle2,
  Compass,
  Disc3,
  ExternalLink,
  Filter,
  Flame,
  Gem,
  KeyRound,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  ShoppingBag,
  Sparkles,
  Target,
  Trophy,
  TrendingUp,
  Users,
  X,
  Zap,
} from 'lucide-react';

const LOCAL_DISCOGS_TOKEN_KEY = 'cd_import_tracker_discogs_token_v1';
const LOCAL_ML_COOKIE_KEY = 'cd_import_tracker_ml_cookie_v1';

function getCollectorAndSourcingBadges(item: TopAlbumItem): {
  demandLabel: string;
  demandClass: string;
  sourcingLabel: string;
  sourcingTooltip: string;
  sourcingClass: string;
} {
  const { wants, haves, scarcityRatio } = item;

  let demandLabel = '🎯 Nicho / Fãs';
  let demandClass = 'bg-slate-800 text-slate-300 border-slate-700';

  if (wants >= 1200) {
    demandLabel = '🔥 Desejo Extremo';
    demandClass = 'bg-amber-500/20 text-amber-300 border-amber-500/40';
  } else if (wants >= 400) {
    demandLabel = '🔥 Alta Procura';
    demandClass = 'bg-amber-500/15 text-amber-300 border-amber-500/30';
  } else if (wants >= 130) {
    demandLabel = '📈 Demanda Cult / Sólida';
    demandClass = 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30';
  }

  let sourcingLabel = '✈️ Bom p/ Garimpar Lá Fora';
  let sourcingTooltip =
    'Existe oferta nos EUA/Europa para comprar no eBay, mas costuma ser raro à venda no Brasil.';
  let sourcingClass = 'bg-sky-500/15 text-sky-300 border-sky-500/30';

  if (scarcityRatio >= 1.2 || haves < 350) {
    sourcingLabel = '💎 Raro até no Exterior';
    sourcingTooltip =
      'Poucas pessoas possuem até mesmo fora do Brasil. Item disputado mundialmente.';
    sourcingClass = 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30';
  } else if (haves > 4500) {
    sourcingLabel = '📦 Abundante no Exterior';
    sourcingTooltip =
      'Fácil de encontrar barato lá fora. Verifique abaixo se é escasso ou caro no ML Brasil.';
    sourcingClass = 'bg-slate-800/90 text-slate-400 border-slate-700';
  }

  return {
    demandLabel,
    demandClass,
    sourcingLabel,
    sourcingTooltip,
    sourcingClass,
  };
}

function getVerdictStyle(verdict: BrazilMarketVerdict): string {
  switch (verdict) {
    case 'white_whale':
      return 'bg-fuchsia-500/20 border-fuchsia-500/40 text-fuchsia-200';
    case 'opportunity':
      return 'bg-emerald-500/20 border-emerald-500/40 text-emerald-200';
    case 'saturated':
      return 'bg-rose-500/15 border-rose-500/30 text-rose-200';
    default:
      return 'bg-amber-500/15 border-amber-500/30 text-amber-200';
  }
}

export function DemandRadarView() {
  const [format, setFormat] = useState<DemandFormat>('CD');
  const [selectedSubgenreId, setSelectedSubgenreId] = useState<string>('all');
  const [sortMode, setSortMode] = useState<DemandSortMode>('opportunity');
  const [hideCommonClassics, setHideCommonClassics] = useState<boolean>(true);
  const [hideMlSaturated, setHideMlSaturated] = useState<boolean>(false);
  const [localFilter, setLocalFilter] = useState<string>('');

  const [items, setItems] = useState<TopAlbumItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [requiresToken, setRequiresToken] = useState<boolean>(false);

  const [customToken, setCustomToken] = useState<string>('');
  const [tokenInput, setTokenInput] = useState<string>('');

  // Sessão do Mercado Livre BR (Cookie ou Copy as cURL da aba logada do Chrome)
  const [mlCookie, setMlCookie] = useState<string>('');
  const [mlCookieDraft, setMlCookieDraft] = useState<string>('');
  const [isMlSessionOpen, setIsMlSessionOpen] = useState<boolean>(false);

  // Estado do Buscador Global de Posição no Ranking
  const [lookupQuery, setLookupQuery] = useState<string>('');
  const [lookupResults, setLookupResults] = useState<TopAlbumItem[] | null>(
    null
  );
  const [lookupCutoffWants, setLookupCutoffWants] = useState<number>(0);
  const [isLookupLoading, setIsLookupLoading] = useState<boolean>(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  // Estado da checagem no Mercado Livre BR
  const [mlLoadingById, setMlLoadingById] = useState<Record<number, boolean>>(
    {}
  );
  const [mlDataById, setMlDataById] = useState<
    Record<number, MercadoLivreOfferSummary>
  >({});
  const [batchScanProgress, setBatchScanProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);

  useEffect(() => {
    try {
      const savedToken = localStorage.getItem(LOCAL_DISCOGS_TOKEN_KEY) || '';
      if (savedToken) {
        setCustomToken(savedToken);
        setTokenInput(savedToken);
      }
      const savedMlCookie = localStorage.getItem(LOCAL_ML_COOKIE_KEY) || '';
      if (savedMlCookie) {
        setMlCookie(savedMlCookie);
        setMlCookieDraft(savedMlCookie);
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  const currentSubgenre = useMemo(
    () =>
      ROCK_METAL_SUBGENRES.find((s) => s.id === selectedSubgenreId) ||
      ROCK_METAL_SUBGENRES[0],
    [selectedSubgenreId]
  );

  const fetchTop100 = useCallback(
    async (forceRefresh = false) => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const params = new URLSearchParams({
          format,
          style: currentSubgenre.discogsStyle,
        });
        if (forceRefresh) {
          params.set('refresh', '1');
        }

        const headers: Record<string, string> = {};
        if (customToken.trim()) {
          headers['x-discogs-token'] = customToken.trim();
        }

        const res = await fetch(`/api/demand/top100?${params.toString()}`, {
          headers,
        });
        const data = await res.json();

        if (data.requiresToken) {
          setRequiresToken(true);
          setItems([]);
          setErrorMessage(data.message || null);
        } else if (!res.ok) {
          setRequiresToken(false);
          setErrorMessage(
            data.message || 'Erro ao carregar o Top 100 do Discogs.'
          );
        } else {
          setRequiresToken(false);
          setItems(Array.isArray(data.items) ? data.items : []);
        }
      } catch {
        setErrorMessage(
          'Falha de conexão ao buscar dados do Discogs. Tente novamente.'
        );
      } finally {
        setIsLoading(false);
      }
    },
    [format, currentSubgenre.discogsStyle, customToken]
  );

  useEffect(() => {
    fetchTop100(false);
  }, [fetchTop100]);

  const handleCheckMercadoLivre = useCallback(
    async (item: TopAlbumItem, cookieOverride?: string) => {
      setMlLoadingById((prev) => ({ ...prev, [item.id]: true }));
      try {
        const params = new URLSearchParams({
          artist: item.artist,
          album: item.albumTitle,
          format: item.format,
        });
        const activeCookie =
          cookieOverride !== undefined ? cookieOverride : mlCookie;
        const headers: Record<string, string> = {};
        if (activeCookie.trim()) {
          headers['x-ml-cookie'] = activeCookie.trim();
        }

        const res = await fetch(
          `/api/demand/mercadolivre?${params.toString()}`,
          { headers }
        );
        const summary: MercadoLivreOfferSummary = await res.json();
        setMlDataById((prev) => ({ ...prev, [item.id]: summary }));
        if (summary.requiresMlSession) {
          setIsMlSessionOpen(true);
        }
      } catch {
        setMlDataById((prev) => ({
          ...prev,
          [item.id]: {
            query: `${item.artist} ${item.albumTitle}`,
            totalActiveListings: 0,
            matchedAlbumCount: 0,
            lowestPriceBrl: null,
            averagePriceBrl: null,
            medianPriceBrl: null,
            highestPriceBrl: null,
            verdict: 'competitive',
            verdictLabel: 'Abrir no Mercado Livre BR',
            verdictReason:
              'Use o botão "Abrir ML" para conferir os anúncios ativos.',
            searchUrl: item.mlSearchUrl,
            topItems: [],
          },
        }));
      } finally {
        setMlLoadingById((prev) => ({ ...prev, [item.id]: false }));
      }
    },
    [mlCookie]
  );

  const handleSaveMlCookie = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = mlCookieDraft.trim();
    setMlCookie(trimmed);
    setMlDataById({}); // Limpa resultados anteriores para reconsultar com o novo Cookie
    try {
      if (trimmed) {
        localStorage.setItem(LOCAL_ML_COOKIE_KEY, trimmed);
      } else {
        localStorage.removeItem(LOCAL_ML_COOKIE_KEY);
      }
    } catch {
      // ignore
    }
    setIsMlSessionOpen(false);
  };

  const handleLookupSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = lookupQuery.trim();
    if (!trimmed) return;

    setIsLookupLoading(true);
    setLookupError(null);

    try {
      const params = new URLSearchParams({
        q: trimmed,
        format,
        style: currentSubgenre.discogsStyle,
      });

      const headers: Record<string, string> = {};
      if (customToken.trim()) {
        headers['x-discogs-token'] = customToken.trim();
      }

      const res = await fetch(`/api/demand/lookup?${params.toString()}`, {
        headers,
      });
      const data = await res.json();

      if (!res.ok) {
        setLookupError(
          data.error || 'Não foi possível pesquisar este artista/álbum agora.'
        );
        setLookupResults([]);
      } else {
        const foundList: TopAlbumItem[] = Array.isArray(data.results)
          ? data.results
          : [];
        setLookupResults(foundList);
        setLookupCutoffWants(Number(data.top100CutoffWants || 0));

        setIsLookupLoading(false);
        const chunkSize = 3;
        for (let i = 0; i < foundList.length; i += chunkSize) {
          const chunk = foundList.slice(i, i + chunkSize);
          await Promise.all(
            chunk.map((album) => handleCheckMercadoLivre(album))
          );
        }
        return;
      }
    } catch {
      setLookupError('Erro de conexão ao consultar posição no Discogs.');
    } finally {
      setIsLookupLoading(false);
    }
  };

  const handleSaveToken = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = tokenInput.trim();
    setCustomToken(trimmed);
    try {
      if (trimmed) {
        localStorage.setItem(LOCAL_DISCOGS_TOKEN_KEY, trimmed);
      } else {
        localStorage.removeItem(LOCAL_DISCOGS_TOKEN_KEY);
      }
    } catch {
      // ignore
    }
  };

  const displayedItems = useMemo(() => {
    const query = localFilter.trim().toLowerCase();
    let list = [...items];

    if (hideCommonClassics) {
      list = list.filter((i) => !i.isCommonClassic);
    }

    if (hideMlSaturated) {
      list = list.filter((i) => {
        const ml = mlDataById[i.id];
        return !ml || ml.verdict !== 'saturated';
      });
    }

    if (query) {
      list = list.filter(
        (item) =>
          item.artist.toLowerCase().includes(query) ||
          item.albumTitle.toLowerCase().includes(query) ||
          item.styles.some((s) => s.toLowerCase().includes(query))
      );
    }

    if (sortMode === 'opportunity') {
      list.sort((a, b) => b.opportunityScore - a.opportunityScore);
    } else if (sortMode === 'scarcity') {
      list.sort((a, b) => {
        if (b.scarcityRatio !== a.scarcityRatio) {
          return b.scarcityRatio - a.scarcityRatio;
        }
        return b.wants - a.wants;
      });
    } else {
      list.sort((a, b) => b.wants - a.wants);
    }

    return list.slice(0, 100);
  }, [
    items,
    localFilter,
    sortMode,
    hideCommonClassics,
    hideMlSaturated,
    mlDataById,
  ]);

  const handleBatchScanMercadoLivre = async () => {
    if (batchScanProgress) return;
    const targets = displayedItems
      .slice(0, 15)
      .filter((item) => !mlDataById[item.id]);

    if (targets.length === 0) return;

    setBatchScanProgress({ current: 0, total: targets.length });
    const chunkSize = 3;

    for (let i = 0; i < targets.length; i += chunkSize) {
      const chunk = targets.slice(i, i + chunkSize);
      await Promise.all(chunk.map((item) => handleCheckMercadoLivre(item)));
      setBatchScanProgress({
        current: Math.min(i + chunk.length, targets.length),
        total: targets.length,
      });
    }

    setBatchScanProgress(null);
  };

  const radarStats = useMemo(() => {
    const activeList = displayedItems.length > 0 ? displayedItems : items;
    if (activeList.length === 0) {
      return {
        avgWants: 0,
        cutoffWants: 0,
        topOpportunity: null as TopAlbumItem | null,
        topScarce: null as TopAlbumItem | null,
      };
    }
    const totalWants = activeList.reduce((acc, i) => acc + i.wants, 0);
    const byOpp = [...activeList].sort(
      (a, b) => b.opportunityScore - a.opportunityScore
    );
    const byScarcity = [...activeList].sort(
      (a, b) => b.scarcityRatio - a.scarcityRatio
    );
    const byWants = [...activeList].sort((a, b) => b.wants - a.wants);
    return {
      avgWants: Math.round(totalWants / activeList.length),
      cutoffWants: byWants[byWants.length - 1]?.wants || 0,
      topOpportunity: byOpp[0] || null,
      topScarce: byScarcity[0] || null,
    };
  }, [displayedItems, items]);

  const renderAlbumCard = (
    item: TopAlbumItem,
    rankBadgeText: string,
    isLookupMode = false
  ) => {
    const badges = getCollectorAndSourcingBadges(item);
    const mlSummary = mlDataById[item.id];
    const isMlLoading = Boolean(mlLoadingById[item.id]);

    return (
      <div
        key={`${isLookupMode ? 'lookup' : 'top'}-${item.id}`}
        className={`rounded-2xl border p-4 flex flex-col justify-between gap-4 transition shadow-lg ${
          mlSummary?.verdict === 'white_whale' ||
          mlSummary?.verdict === 'opportunity'
            ? 'bg-slate-900/95 border-emerald-500/50 shadow-emerald-950/20'
            : mlSummary?.verdict === 'saturated'
              ? 'bg-slate-900/60 border-slate-800/70 opacity-80'
              : isLookupMode
                ? 'bg-slate-900/95 border-indigo-500/40'
                : 'bg-slate-900/90 border-slate-800/90 hover:border-slate-700'
        }`}
      >
        {/* Banner Superior de Posição no Ranking (Modo Busca Global) */}
        {isLookupMode && item.estimatedRank && (
          <div
            className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs font-semibold border ${
              item.isInsideTop100
                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                : 'bg-indigo-500/15 border-indigo-500/30 text-indigo-200'
            }`}
          >
            <div className="flex items-center gap-1.5">
              {item.isInsideTop100 ? (
                <>
                  <Trophy className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>
                    Está no Top 100! Posição{' '}
                    <strong className="font-mono text-white">
                      #{item.estimatedRank}
                    </strong>{' '}
                    ({currentSubgenre.label})
                  </span>
                </>
              ) : (
                <>
                  <Compass className="w-4 h-4 text-indigo-400 shrink-0" />
                  <span>
                    Posição Estimada:{' '}
                    <strong className="font-mono text-white text-sm">
                      ~#{item.estimatedRank.toLocaleString('pt-BR')}
                    </strong>{' '}
                    ({currentSubgenre.label})
                  </span>
                </>
              )}
            </div>

            {!item.isInsideTop100 &&
              typeof item.wantsToReachTop100 === 'number' && (
                <span className="text-[11px] font-mono text-amber-300 shrink-0">
                  Faltam +{item.wantsToReachTop100.toLocaleString('pt-BR')}{' '}
                  wants p/ Top 100
                </span>
              )}
          </div>
        )}

        {/* Topo do Card: Capa + Dados Principais */}
        <div className="flex gap-3.5">
          <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden bg-slate-950 border border-slate-800 shrink-0">
            {item.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.coverUrl}
                alt={item.fullTitle}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-600">
                <Disc3 className="w-8 h-8" />
              </div>
            )}
            <div className="absolute top-1.5 left-1.5 rounded-md bg-slate-950/90 border border-slate-700/80 px-1.5 py-0.5 text-[11px] font-mono font-bold text-white shadow">
              {rankBadgeText}
            </div>
          </div>

          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-400 truncate">
                {item.artist}
              </p>
              {item.year && (
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-slate-300 shrink-0">
                  {item.year}
                </span>
              )}
            </div>

            <h3
              className="text-sm sm:text-base font-bold text-white leading-snug line-clamp-2"
              title={item.albumTitle}
            >
              {item.albumTitle}
            </h3>

            <div className="flex flex-wrap gap-1 pt-0.5">
              <span className="rounded bg-slate-950 border border-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-300">
                {item.format}
              </span>
              {item.styles.slice(0, 2).map((st) => (
                <span
                  key={st}
                  className="rounded bg-slate-800/70 px-1.5 py-0.5 text-[10px] text-slate-400"
                >
                  {st}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Métricas de Desejo (Discogs) */}
        <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-950/80 border border-slate-800/80 p-2.5 text-center">
          <div>
            <span className="text-[10px] text-slate-400 flex items-center justify-center gap-1">
              <Flame className="w-3 h-3 text-amber-400" />
              Procura (Wants)
            </span>
            <span className="text-xs sm:text-sm font-mono font-bold text-amber-300">
              {item.wants.toLocaleString('pt-BR')}
            </span>
          </div>

          <div className="border-x border-slate-800/80">
            <span className="text-[10px] text-slate-400 flex items-center justify-center gap-1">
              <Users className="w-3 h-3 text-slate-400" />
              No Exterior (Haves)
            </span>
            <span className="text-xs sm:text-sm font-mono font-semibold text-slate-200">
              {item.haves.toLocaleString('pt-BR')}
            </span>
          </div>

          <div>
            <span className="text-[10px] text-slate-400 flex items-center justify-center gap-1">
              <TrendingUp className="w-3 h-3 text-fuchsia-400" />
              Wants ÷ Haves
            </span>
            <span className="text-xs sm:text-sm font-mono font-bold text-white">
              {item.scarcityRatio.toFixed(2)}x
            </span>
          </div>
        </div>

        {/* Rótulos Claros: (1) Nível de Desejo + (2) Disponibilidade p/ Garimpar lá fora */}
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={`inline-flex items-center rounded-lg border px-2 py-0.5 text-[10px] font-semibold ${badges.demandClass}`}
              >
                {badges.demandLabel}
              </span>
              <span
                title={badges.sourcingTooltip}
                className={`inline-flex items-center rounded-lg border px-2 py-0.5 text-[10px] font-semibold ${badges.sourcingClass}`}
              >
                {badges.sourcingLabel}
              </span>
            </div>

            <div className="flex items-center gap-1">
              <a
                href={item.ebaySearchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg bg-slate-800 hover:bg-slate-700 px-2 py-1 text-[11px] font-medium text-slate-200 transition"
                title="Buscar este álbum no eBay para importar"
              >
                eBay
                <ExternalLink className="w-3 h-3" />
              </a>
              <a
                href={item.discogsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg bg-slate-800 hover:bg-slate-700 px-2 py-1 text-[11px] font-medium text-slate-200 transition"
                title="Abrir página no Discogs"
              >
                Discogs
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          {/* Botão ou Painel do Mercado Livre BR (Apenas Envio Nacional) */}
          {!mlSummary ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleCheckMercadoLivre(item)}
                disabled={isMlLoading}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 px-3 py-2 text-xs font-semibold text-amber-200 transition cursor-pointer disabled:opacity-50"
              >
                {isMlLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Verificando raridade e preço no Brasil (ML)...
                  </>
                ) : (
                  <>
                    <ShoppingBag className="w-3.5 h-3.5 text-amber-400" />
                    Checar Raridade e Preço no Brasil (ML 🇧🇷)
                  </>
                )}
              </button>

              <a
                href={item.mlSearchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 px-2.5 py-2 text-xs text-slate-300 transition"
                title="Abrir busca no Mercado Livre já filtrada com Envio Local (Brasil)"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          ) : (
            <div className="rounded-xl bg-slate-950 border border-slate-800 p-3 space-y-2.5">
              {/* Selo de Veredito Brasil */}
              <div
                className={`rounded-lg border px-2.5 py-1.5 flex items-center justify-between gap-2 ${getVerdictStyle(
                  mlSummary.verdict
                )}`}
              >
                <span className="text-[11px] font-bold">
                  {mlSummary.verdictLabel}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  {mlSummary.requiresMlSession && (
                    <button
                      type="button"
                      onClick={() => setIsMlSessionOpen(true)}
                      className="text-[11px] font-bold underline text-amber-300 hover:text-white cursor-pointer"
                    >
                      Conectar agora
                    </button>
                  )}
                  <a
                    href={mlSummary.searchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-semibold underline hover:opacity-80"
                  >
                    Abrir ML
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>

              <p className="text-[11px] text-slate-300 leading-snug">
                {mlSummary.verdictReason}
              </p>

              {mlSummary.averagePriceBrl !== null && (
                <>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-slate-900 p-1.5 border border-slate-800/80">
                      <span className="text-[10px] text-slate-400 block">
                        À venda no BR
                      </span>
                      <span
                        className="text-xs font-mono font-bold text-white"
                        title={`Anúncios exatos deste álbum em ${item.format} no Brasil: ${mlSummary.matchedAlbumCount}`}
                      >
                        {mlSummary.matchedAlbumCount} un.
                      </span>
                    </div>
                    <div className="rounded-lg bg-slate-900 p-1.5 border border-slate-800/80">
                      <span className="text-[10px] text-slate-400 block">
                        Preço Médio
                      </span>
                      <span className="text-xs font-mono font-bold text-amber-300">
                        {formatBrl(mlSummary.averagePriceBrl)}
                      </span>
                    </div>
                    <div className="rounded-lg bg-slate-900 p-1.5 border border-slate-800/80">
                      <span className="text-[10px] text-slate-400 block">
                        Menor Preço
                      </span>
                      <span className="text-xs font-mono font-bold text-emerald-400">
                        {mlSummary.lowestPriceBrl
                          ? formatBrl(mlSummary.lowestPriceBrl)
                          : '-'}
                      </span>
                    </div>
                  </div>

                  {mlSummary.topItems.length > 0 && (
                    <div className="space-y-1 pt-1 border-t border-slate-800/80">
                      {mlSummary.topItems.map((sample) => (
                        <a
                          key={sample.id}
                          href={sample.permalink || mlSummary.searchUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-[11px] bg-slate-900/60 hover:bg-slate-800/80 text-slate-300 transition"
                        >
                          <span className="truncate">{sample.title}</span>
                          <span className="font-mono font-semibold text-emerald-300 shrink-0">
                            {formatBrl(sample.price)}
                          </span>
                        </a>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Banner / Header da Tela */}
      <div className="rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950/60 border border-slate-800 p-4 sm:p-6 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 rounded-full bg-indigo-500/15 border border-indigo-500/30 px-3 py-1 text-xs font-medium text-indigo-300">
              <Flame className="w-3.5 h-3.5 text-amber-400" />
              Radar de Arbitragem: Desejo de Compra + Raridade à Venda no Brasil
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              Top 100 Oportunidades de Importação (Rock & Metal)
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 max-w-3xl">
              Cruza o desejo de colecionadores (Wantlist) com a disponibilidade
              real à venda no Brasil (Mercado Livre Envio Local), separando o
              que é fácil comprar lá fora e raro/caro aqui no Brasil.
            </p>
          </div>

          {/* Seletor de Formato + Sessão ML + Scanner ML + Atualizar */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsMlSessionOpen((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-semibold border transition cursor-pointer ${
                mlCookie
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                  : 'bg-slate-800/90 hover:bg-slate-700 border-amber-500/40 text-amber-300'
              }`}
              title="Conectar Cookie da sua aba logada do Mercado Livre para leitura automática de preços"
            >
              {mlCookie ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  Sessão ML Ativa
                </>
              ) : (
                <>
                  <Link2 className="w-3.5 h-3.5 text-amber-400" />
                  Conectar Sessão ML
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleBatchScanMercadoLivre}
              disabled={isLoading || Boolean(batchScanProgress)}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 px-3.5 py-2.5 text-xs font-bold shadow-lg shadow-amber-500/20 transition cursor-pointer disabled:opacity-60"
              title="Verifica automaticamente no Mercado Livre BR os primeiros 15 álbuns da lista"
            >
              {batchScanProgress ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Escaneando ML ({batchScanProgress.current}/
                  {batchScanProgress.total})...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  Escanear Top 15 no ML 🇧🇷
                </>
              )}
            </button>

            <div className="inline-flex rounded-xl bg-slate-950 p-1 border border-slate-800">
              <button
                type="button"
                onClick={() => setFormat('CD')}
                className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs sm:text-sm font-semibold transition cursor-pointer ${
                  format === 'CD'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Disc3 className="w-4 h-4" />
                CDs
              </button>
              <button
                type="button"
                onClick={() => setFormat('Vinyl')}
                className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs sm:text-sm font-semibold transition cursor-pointer ${
                  format === 'Vinyl'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Sparkles className="w-4 h-4" />
                Vinil (LP)
              </button>
            </div>

            <button
              type="button"
              onClick={() => fetchTop100(true)}
              disabled={isLoading}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-800/90 hover:bg-slate-700/80 border border-slate-700 px-3 py-2.5 text-xs font-medium text-slate-200 transition cursor-pointer disabled:opacity-50"
              title="Atualizar dados ignorando cache"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`}
              />
            </button>
          </div>
        </div>

        {/* Painel Recolhível para Colar o Cookie / cURL da aba logada do Mercado Livre */}
        {isMlSessionOpen && (
          <div className="mt-4 pt-4 border-t border-slate-800/90 bg-slate-950/90 rounded-xl p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <h4 className="text-xs sm:text-sm font-bold text-amber-300 flex items-center gap-2">
                  <Link2 className="w-4 h-4" />
                  Conectar sua aba logada do Mercado Livre (Leva 10 segundos)
                </h4>
                <p className="text-xs text-slate-300 leading-relaxed">
                  O Mercado Livre bloqueia servidores sem login redirecionando
                  para <code>/gz/account-verification</code>. Para o nosso
                  sistema ler exatamente os mesmos anúncios e preços que o seu
                  Chrome enxerga:
                </p>
                <ol className="text-[11px] text-slate-400 list-decimal list-inside space-y-0.5 pt-1">
                  <li>
                    Na sua aba aberta do Mercado Livre no Chrome, aperte{' '}
                    <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 font-mono">
                      Cmd + Option + I
                    </kbd>{' '}
                    (ou F12) e clique na aba <strong>Network (Rede)</strong>.
                  </li>
                  <li>
                    Recarregue a página do ML, clique com o botão direito no 1º
                    item da lista &rarr;{' '}
                    <strong>Copy &rarr; Copy as cURL</strong>.
                  </li>
                  <li>
                    Cole tudo no campo abaixo e clique em{' '}
                    <strong>Salvar Sessão ML</strong> (nós extraímos o Cookie
                    automaticamente!).
                  </li>
                </ol>
              </div>
              <button
                type="button"
                onClick={() => setIsMlSessionOpen(false)}
                className="text-slate-400 hover:text-white p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={handleSaveMlCookie}
              className="flex flex-col sm:flex-row gap-2"
            >
              <input
                type="text"
                value={mlCookieDraft}
                onChange={(e) => setMlCookieDraft(e.target.value)}
                placeholder="Cole aqui o 'Copy as cURL' ou o cabeçalho Cookie da sua aba do Mercado Livre..."
                className="flex-1 rounded-xl bg-slate-900 border border-slate-700 px-3.5 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500 font-mono"
              />
              <button
                type="submit"
                className="rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 px-4 py-2 text-xs font-bold transition cursor-pointer shrink-0"
              >
                Salvar Sessão ML
              </button>
            </form>
          </div>
        )}

        {/* KPIs Rápidos do Subgênero Selecionado */}
        {items.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5 pt-5 border-t border-slate-800/80">
            <div className="rounded-xl bg-slate-950/70 border border-slate-800/80 p-3.5">
              <span className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">
                Corte do Top 100 ({currentSubgenre.label})
              </span>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-sm font-bold text-white">
                  #100 exige {radarStats.cutoffWants.toLocaleString('pt-BR')}{' '}
                  wants
                </span>
                <span className="text-xs font-mono font-semibold text-indigo-400">
                  Média: ~{radarStats.avgWants.toLocaleString('pt-BR')}
                </span>
              </div>
            </div>

            <div className="rounded-xl bg-slate-950/70 border border-slate-800/80 p-3.5">
              <span className="text-[11px] uppercase tracking-wider text-emerald-400 font-medium">
                🎯 #1 Melhor Score (Demanda + Escassez)
              </span>
              {radarStats.topOpportunity && (
                <div className="mt-1 flex items-baseline justify-between gap-2">
                  <span className="text-sm font-bold text-white truncate">
                    {radarStats.topOpportunity.artist} —{' '}
                    {radarStats.topOpportunity.albumTitle}
                  </span>
                  <span className="text-xs font-mono font-semibold text-amber-300 shrink-0">
                    {radarStats.topOpportunity.wants.toLocaleString('pt-BR')}w •{' '}
                    {radarStats.topOpportunity.scarcityRatio.toFixed(2)}x
                  </span>
                </div>
              )}
            </div>

            <div className="rounded-xl bg-slate-950/70 border border-slate-800/80 p-3.5">
              <span className="text-[11px] uppercase tracking-wider text-fuchsia-400 font-medium">
                💎 #1 Maior Escassez (Wants ÷ Haves)
              </span>
              {radarStats.topScarce && (
                <div className="mt-1 flex items-baseline justify-between gap-2">
                  <span className="text-sm font-bold text-white truncate">
                    {radarStats.topScarce.artist} —{' '}
                    {radarStats.topScarce.albumTitle}
                  </span>
                  <span className="text-xs font-mono font-semibold text-fuchsia-300 shrink-0">
                    {radarStats.topScarce.scarcityRatio.toFixed(2)}x
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* BUSCADOR GLOBAL DE POSIÇÃO NO RANKING + CHECAGEM AUTOMÁTICA NO BRASIL */}
      <div className="rounded-2xl bg-gradient-to-r from-indigo-950/50 via-slate-900 to-slate-900 border border-indigo-500/30 p-4 sm:p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
              <Compass className="w-4 h-4 text-indigo-400" />
              Consultar Posição e Raridade no Brasil por Artista ou Álbum
            </h3>
            <p className="text-xs text-slate-400">
              Pesquise uma banda (ex: <em>HIM</em>, <em>Tool</em>,{' '}
              <em>Mudvayne</em>, <em>Gojira</em>) ou um álbum: mostra a posição
              no ranking e <strong>verifica automaticamente</strong> quantas
              unidades estão à venda no Mercado Livre Brasil!
            </p>
          </div>

          <form
            onSubmit={handleLookupSearch}
            className="flex items-center gap-2 w-full md:w-[440px]"
          >
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={lookupQuery}
                onChange={(e) => setLookupQuery(e.target.value)}
                placeholder="Digite artista ou artista + álbum..."
                className="w-full rounded-xl bg-slate-950 border border-slate-700 pl-9 pr-8 py-2.5 text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
              />
              {lookupQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setLookupQuery('');
                    setLookupResults(null);
                    setLookupError(null);
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <button
              type="submit"
              disabled={isLookupLoading || !lookupQuery.trim()}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition cursor-pointer shrink-0"
            >
              {isLookupLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Calculando...
                </>
              ) : (
                'Ver Posição + ML 🇧🇷'
              )}
            </button>
          </form>
        </div>

        {/* Resultados da Pesquisa de Posição */}
        {lookupError && (
          <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 text-xs text-rose-200">
            {lookupError}
          </div>
        )}

        {lookupResults !== null && !isLookupLoading && (
          <div className="space-y-3 pt-2 border-t border-slate-800/80">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-indigo-300">
                Resultado de Posição e Oferta no Brasil para &ldquo;
                {lookupQuery}&rdquo; em {currentSubgenre.label} ({format}) —
                Corte do #100: {lookupCutoffWants.toLocaleString('pt-BR')} wants
              </span>
              <button
                type="button"
                onClick={() => setLookupResults(null)}
                className="text-xs text-slate-400 hover:text-white cursor-pointer"
              >
                Fechar pesquisa
              </button>
            </div>

            {lookupResults.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">
                Nenhum álbum de {format} encontrado para &ldquo;{lookupQuery}
                &rdquo;.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {lookupResults.map((item) =>
                  renderAlbumCard(
                    item,
                    item.isInsideTop100
                      ? `#${item.estimatedRank}`
                      : `~#${item.estimatedRank}`,
                    true
                  )
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Pílulas de Subgêneros de Rock & Metal */}
      <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Filtrar Top 100 por Subgênero de Rock & Metal (
            {ROCK_METAL_SUBGENRES.length} estilos)
          </span>
          <span className="text-[11px] text-slate-500">
            Exibindo {displayedItems.length} álbuns únicos
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {ROCK_METAL_SUBGENRES.map((sub) => {
            const active = sub.id === selectedSubgenreId;
            return (
              <button
                key={sub.id}
                type="button"
                onClick={() => setSelectedSubgenreId(sub.id)}
                className={`rounded-xl px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                  active
                    ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30 border border-indigo-400/40'
                    : 'bg-slate-950/80 text-slate-300 hover:bg-slate-800 border border-slate-800'
                }`}
              >
                {sub.label}
              </button>
            );
          })}
        </div>

        {/* Barra de Ordenação Inteligente + Filtros */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 pt-3 border-t border-slate-800/80">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400 mr-1">Ordenar por:</span>

            <button
              type="button"
              onClick={() => setSortMode('opportunity')}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition cursor-pointer ${
                sortMode === 'opportunity'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
              title="Equilibra Alta Procura com Escassez"
            >
              <Target className="w-3.5 h-3.5" />
              Melhor Oportunidade (Procura + Escassez)
            </button>

            <button
              type="button"
              onClick={() => setSortMode('scarcity')}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition cursor-pointer ${
                sortMode === 'scarcity'
                  ? 'bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/40'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              <Gem className="w-3.5 h-3.5" />
              Maior Escassez (Wants ÷ Haves)
            </button>

            <button
              type="button"
              onClick={() => setSortMode('wants')}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition cursor-pointer ${
                sortMode === 'wants'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              <Flame className="w-3.5 h-3.5" />
              Total de Wants Absoluto
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setHideCommonClassics((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium border transition cursor-pointer ${
                hideCommonClassics
                  ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-200'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
              title="Oculta álbuns mega-abundantes (>5.000 Haves, como Nevermind, Californication, Ten)"
            >
              <Filter className="w-3.5 h-3.5" />
              {hideCommonClassics
                ? 'Sem Clássicos Batidos (>5k Haves)'
                : 'Mostrando Clássicos Batidos'}
            </button>

            <button
              type="button"
              onClick={() => setHideMlSaturated((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium border transition cursor-pointer ${
                hideMlSaturated
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
              title="Oculta álbuns que você já checou no ML e deram 'Já Comum / Barato no BR'"
            >
              {hideMlSaturated
                ? 'Ocultando Comuns no ML'
                : 'Ocultar Comuns no ML'}
            </button>

            <div className="relative w-full sm:w-60">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={localFilter}
                onChange={(e) => setLocalFilter(e.target.value)}
                placeholder="Filtrar rápido na lista..."
                className="w-full rounded-xl bg-slate-950 border border-slate-800 pl-9 pr-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Caso o usuário precise/queira configurar um Token manualmente */}
      {requiresToken && (
        <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-5 space-y-3">
          <div className="flex items-center gap-2 text-amber-300 font-semibold text-sm">
            <KeyRound className="w-4 h-4" />
            Configuração Rápida de Credencial do Discogs
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            {errorMessage ||
              'Para consultar o Top 100 oficial do Discogs, informe seu Personal Access Token ou configure DISCOGS_CONSUMER_KEY no .env.local.'}
          </p>
          <form
            onSubmit={handleSaveToken}
            className="flex flex-col sm:flex-row gap-2 max-w-xl"
          >
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="Cole seu Discogs Token aqui..."
              className="flex-1 rounded-xl bg-slate-950 border border-slate-700 px-3.5 py-2 text-xs text-white"
            />
            <button
              type="submit"
              className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
            >
              Salvar e Carregar Top 100
            </button>
          </form>
        </div>
      )}

      {/* Estado de Carregamento */}
      {isLoading && (
        <div className="rounded-2xl bg-slate-900/60 border border-slate-800 p-12 flex flex-col items-center justify-center gap-3 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
          <p className="text-sm font-medium text-slate-200">
            Garimpando oportunidades de Rock/Metal no Discogs (
            {currentSubgenre.label} • {format})...
          </p>
          <p className="text-xs text-slate-500">
            Removendo títulos asiáticos duplicados, singles avulsos e
            priorizando potencial de arbitragem
          </p>
        </div>
      )}

      {/* Erro */}
      {!isLoading && errorMessage && !requiresToken && (
        <div className="rounded-2xl bg-rose-500/10 border border-rose-500/30 p-5 text-xs text-rose-200 flex items-center justify-between gap-4">
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => fetchTop100(true)}
            className="rounded-lg bg-rose-500/20 hover:bg-rose-500/30 px-3 py-1.5 font-semibold text-rose-100 shrink-0 cursor-pointer"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* Grid do Top 100 */}
      {!isLoading && !requiresToken && displayedItems.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {displayedItems.map((item, index) =>
            renderAlbumCard(item, `#${index + 1}`, false)
          )}
        </div>
      )}
    </div>
  );
}
