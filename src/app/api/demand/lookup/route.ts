import { NextRequest, NextResponse } from 'next/server';
import { DemandFormat, TopAlbumItem } from '@/types/demand';
import {
  DiscogsSearchResultItem,
  getOrFetchTop100,
  mapDiscogsItemToTopAlbum,
  normalizeAlbumKey,
  resolveDiscogsAuthHeader,
} from '@/lib/discogsDemand';

interface RankCurveCheckpoints {
  timestamp: number;
  points: Array<{ rank: number; wants: number }>;
}

const curveCache = new Map<string, RankCurveCheckpoints>();
const CURVE_TTL_MS = 30 * 60 * 1000;

function normalizeSearchToken(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCompact(str: string): string {
  return normalizeSearchToken(str).replace(/\s+/g, '');
}

async function getRankCurveCheckpoints(params: {
  format: DemandFormat;
  style: string;
  authHeader: string;
  topByWants: TopAlbumItem[];
}): Promise<Array<{ rank: number; wants: number }>> {
  const { format, style, authHeader, topByWants } = params;
  const cacheKey = `V2::${format}::${style || 'ALL'}`;
  const cached = curveCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CURVE_TTL_MS) {
    return cached.points;
  }

  const r1 = topByWants[0]?.wants || 3500;
  const r25 = topByWants[24]?.wants || Math.round(r1 * 0.45);
  const r50 = topByWants[49]?.wants || Math.round(r1 * 0.32);
  const r100 =
    topByWants[Math.min(99, topByWants.length - 1)]?.wants ||
    Math.max(10, Math.round(r1 * 0.22));

  const fetchSampleWants = async (page: number): Promise<number | null> => {
    try {
      const url = new URL('https://api.discogs.com/database/search');
      url.searchParams.set('type', 'release');
      url.searchParams.set('genre', 'Rock');
      url.searchParams.set('format', format);
      if (style) {
        url.searchParams.set('style', style);
      }
      url.searchParams.set('sort', 'want');
      url.searchParams.set('sort_order', 'desc');
      url.searchParams.set('per_page', '50');
      url.searchParams.set('page', String(page));

      const res = await fetch(url.toString(), {
        headers: {
          Authorization: authHeader,
          'User-Agent': 'CDImportTrackerBR/1.0 +https://discogs.com',
          Accept: 'application/json',
        },
        next: { revalidate: 1800 },
      });
      if (!res.ok) return null;
      const data = await res.json();
      const results: DiscogsSearchResultItem[] = Array.isArray(data.results)
        ? data.results
        : [];
      if (results.length === 0) return null;
      const mid = results[Math.floor(results.length / 2)];
      return Number(mid?.community?.want ?? 0);
    } catch {
      return null;
    }
  };

  const [sampleP14, sampleP40, sampleP100] = await Promise.all([
    fetchSampleWants(14),
    fetchSampleWants(40),
    fetchSampleWants(100),
  ]);

  const r350 =
    sampleP14 !== null && sampleP14 < r100
      ? sampleP14
      : Math.max(5, Math.round(r100 * 0.55));
  const r1000 =
    sampleP40 !== null && sampleP40 < r350
      ? sampleP40
      : Math.max(3, Math.round(r350 * 0.48));
  const r2500 =
    sampleP100 !== null && sampleP100 < r1000
      ? sampleP100
      : Math.max(1, Math.round(r1000 * 0.45));

  const points = [
    { rank: 1, wants: r1 },
    { rank: 25, wants: r25 },
    { rank: 50, wants: r50 },
    { rank: 100, wants: r100 },
    { rank: 350, wants: r350 },
    { rank: 1000, wants: r1000 },
    { rank: 2500, wants: r2500 },
    { rank: 5000, wants: Math.max(1, Math.round(r2500 * 0.48)) },
    { rank: 10000, wants: Math.max(1, Math.round(r2500 * 0.22)) },
  ];

  curveCache.set(cacheKey, { timestamp: Date.now(), points });
  return points;
}

function estimateAlbumRank(
  item: TopAlbumItem,
  topByWants: TopAlbumItem[],
  checkpoints: Array<{ rank: number; wants: number }>
): {
  estimatedRank: number;
  isInsideTop100: boolean;
  wantsToReachTop100: number;
  top100CutoffWants: number;
} {
  const top100Slice = topByWants.slice(0, 100);
  const cutoffWants =
    top100Slice.length > 0
      ? top100Slice[top100Slice.length - 1].wants
      : 1000;
  const itemKey = `${normalizeAlbumKey(item.artist)}::${normalizeAlbumKey(item.albumTitle)}`;

  // 1. Verifica se o álbum está exatamente dentro do Top 100
  const exactIdx = top100Slice.findIndex(
    (t) =>
      `${normalizeAlbumKey(t.artist)}::${normalizeAlbumKey(t.albumTitle)}` ===
      itemKey
  );
  if (exactIdx !== -1) {
    return {
      estimatedRank: exactIdx + 1,
      isInsideTop100: true,
      wantsToReachTop100: 0,
      top100CutoffWants: cutoffWants,
    };
  }

  // 2. Se tiver Wants maior ou igual ao #100 daquele estilo, posiciona dentro do Top 100 por Wants
  if (item.wants >= cutoffWants && top100Slice.length > 0) {
    const posByWants = top100Slice.findIndex((t) => item.wants >= t.wants);
    const rank = posByWants !== -1 ? posByWants + 1 : top100Slice.length;
    return {
      estimatedRank: rank,
      isInsideTop100: true,
      wantsToReachTop100: 0,
      top100CutoffWants: cutoffWants,
    };
  }

  // 3. Interpola nos checkpoints de lei de potência (Zipf) para posições > #100 (ex: #320, #1010, #2400, #5500)
  const wants = Math.max(1, item.wants);
  let estimatedRank = 10000;

  for (let i = 0; i < checkpoints.length - 1; i++) {
    const upper = checkpoints[i];
    const lower = checkpoints[i + 1];

    if (wants <= upper.wants && wants >= lower.wants) {
      if (upper.wants === lower.wants) {
        estimatedRank = upper.rank;
      } else {
        const logUpperW = Math.log(Math.max(1, upper.wants));
        const logLowerW = Math.log(Math.max(1, lower.wants));
        const logW = Math.log(wants);
        const t =
          (logUpperW - logW) / Math.max(0.0001, logUpperW - logLowerW);
        const logRank =
          Math.log(upper.rank) +
          t * (Math.log(lower.rank) - Math.log(upper.rank));
        estimatedRank = Math.round(Math.exp(logRank));
      }
      break;
    }
  }

  const lastPoint = checkpoints[checkpoints.length - 1];
  if (wants < lastPoint.wants) {
    const ratio = lastPoint.wants / Math.max(1, wants);
    estimatedRank = Math.min(
      25000,
      Math.round(lastPoint.rank * Math.pow(ratio, 1.15))
    );
  }

  if (estimatedRank <= 100) {
    estimatedRank = 101;
  }

  return {
    estimatedRank,
    isInsideTop100: false,
    wantsToReachTop100: Math.max(1, cutoffWants - item.wants),
    top100CutoffWants: cutoffWants,
  };
}

/**
 * Calcula o nível de relevância de um álbum com o termo pesquisado pelo usuário,
 * garantindo que buscar "HIM" traga apenas a banda HIM (e nunca "The Beatles In Mono" porque tinha a palavra "him" nos créditos!).
 */
function scoreAlbumMatch(
  item: TopAlbumItem,
  rawQuery: string
): number {
  const normQuery = normalizeSearchToken(rawQuery);
  const compactQuery = normalizeCompact(rawQuery);
  const normArtist = normalizeSearchToken(item.artist);
  const compactArtist = normalizeCompact(item.artist);
  const normAlbum = normalizeSearchToken(item.albumTitle);
  const normCombined = `${normArtist} ${normAlbum}`;

  if (!normQuery) return 0;

  // Match exato do nome do artista (ex: "HIM" === "him" ou "h.i.m." -> compactArtist === "him")
  if (normArtist === normQuery || compactArtist === compactQuery) {
    return 100;
  }

  // Match exato do álbum
  if (normAlbum === normQuery) {
    return 90;
  }

  // Artista começa com a query ou contém a query como palavra inteira (para queries >= 3 letras)
  const queryWords = normQuery.split(' ').filter(Boolean);
  const artistWords = new Set(normArtist.split(' ').filter(Boolean));
  const albumWords = new Set(normAlbum.split(' ').filter(Boolean));

  // Se a busca for curta (<= 4 letras, ex: "HIM", "Korn", "Tool"), exige que a palavra exata esteja no Artista ou no Álbum
  if (compactQuery.length <= 4 && queryWords.length === 1) {
    const word = queryWords[0];
    if (artistWords.has(word)) return 85;
    if (albumWords.has(word)) return 70;
    return 0; // Descarta falsos positivos onde "him" estava apenas nos créditos/faixas!
  }

  // Para buscas com múltiplas palavras (ex: "HIM Razorblade Romance" ou "Sepultura Roots")
  const matchedInCombined = queryWords.filter(
    (w) =>
      artistWords.has(w) ||
      albumWords.has(w) ||
      (w.length >= 4 && normCombined.includes(w))
  );

  if (matchedInCombined.length === queryWords.length) {
    return 95;
  }

  if (
    queryWords.length >= 2 &&
    matchedInCombined.length >= Math.ceil(queryWords.length * 0.75)
  ) {
    return 75;
  }

  if (normArtist.includes(normQuery) || normAlbum.includes(normQuery)) {
    return 65;
  }

  return 0;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get('q') || '').trim();
  const formatParam = (searchParams.get('format') || 'CD') as DemandFormat;
  const format: DemandFormat = formatParam === 'Vinyl' ? 'Vinyl' : 'CD';
  const style = (searchParams.get('style') || '').trim();

  if (!query) {
    return NextResponse.json(
      { error: 'Informe um artista ou álbum para pesquisar.' },
      { status: 400 }
    );
  }

  const { authHeader } = resolveDiscogsAuthHeader(
    request.headers.get('x-discogs-token')
  );

  if (!authHeader) {
    return NextResponse.json(
      {
        error:
          'Configure suas credenciais gratuitas do Discogs para pesquisar artistas e álbuns.',
      },
      { status: 401 }
    );
  }

  try {
    const fetchDiscogsQuery = async (
      extraParams: Record<string, string>
    ): Promise<DiscogsSearchResultItem[]> => {
      const url = new URL('https://api.discogs.com/database/search');
      url.searchParams.set('type', 'release');
      url.searchParams.set('genre', 'Rock');
      url.searchParams.set('format', format);
      url.searchParams.set('sort', 'want');
      url.searchParams.set('sort_order', 'desc');
      url.searchParams.set('per_page', '100');
      url.searchParams.set('page', '1');
      for (const [k, v] of Object.entries(extraParams)) {
        if (v) url.searchParams.set(k, v);
      }

      const res = await fetch(url.toString(), {
        headers: {
          Authorization: authHeader,
          'User-Agent': 'CDImportTrackerBR/1.0 +https://discogs.com',
          Accept: 'application/json',
        },
        next: { revalidate: 900 },
      });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data.results) ? data.results : [];
    };

    // Fazemos duas buscas em paralelo no Discogs:
    // 1. `artist=${query}` (para quando o usuário digita o nome da banda, ex: "HIM", "Mudvayne", "Sepultura")
    // 2. `q=${query}` (para quando o usuário digita "Artista + Álbum" ou só o nome do Álbum)
    const [top100Result, byArtistResults, byGeneralResults] = await Promise.all(
      [
        getOrFetchTop100({ format, style, authHeader }),
        fetchDiscogsQuery({ artist: query }),
        fetchDiscogsQuery({ q: query }),
      ]
    );

    // Ordena o Top 100 por Wants decrescente para ter a régua real de corte do #100
    const topByWants = [...top100Result.items].sort(
      (a, b) => b.wants - a.wants
    );

    const checkpoints = await getRankCurveCheckpoints({
      format,
      style,
      authHeader,
      topByWants,
    });

    const combinedRaw = [...byArtistResults, ...byGeneralResults];
    const deduplicatedMap = new Map<
      string,
      { album: TopAlbumItem; matchScore: number }
    >();

    for (const item of combinedRaw) {
      const mapped = mapDiscogsItemToTopAlbum(item, format, true);
      if (!mapped) continue;

      const matchScore = scoreAlbumMatch(mapped, query);
      if (matchScore <= 0) continue; // Descarta resultados onde o nome do artista/álbum não bate com a pesquisa!

      const normKey = `${normalizeAlbumKey(mapped.artist)}::${normalizeAlbumKey(mapped.albumTitle)}`;
      if (!normKey || normKey === '::') continue;

      const existing = deduplicatedMap.get(normKey);
      if (
        !existing ||
        matchScore > existing.matchScore ||
        (matchScore === existing.matchScore &&
          mapped.wants > existing.album.wants)
      ) {
        deduplicatedMap.set(normKey, { album: mapped, matchScore });
      }
    }

    // Se houver matches exatos da banda (matchScore === 100), prioriza exibir apenas os álbuns daquela banda!
    const allMatched = Array.from(deduplicatedMap.values());
    const hasExactArtistMatches = allMatched.some((m) => m.matchScore === 100);
    const filteredMatches = hasExactArtistMatches
      ? allMatched.filter((m) => m.matchScore >= 90)
      : allMatched;

    const rankedResults = filteredMatches
      .sort((a, b) => {
        if (b.matchScore !== a.matchScore) {
          return b.matchScore - a.matchScore;
        }
        return b.album.wants - a.album.wants;
      })
      .slice(0, 12)
      .map(({ album }) => {
        const rankInfo = estimateAlbumRank(album, topByWants, checkpoints);
        return {
          ...album,
          ...rankInfo,
        };
      });

    const cutoffWants =
      topByWants[Math.min(99, topByWants.length - 1)]?.wants || 0;

    return NextResponse.json({
      query,
      format,
      style,
      top100CutoffWants: cutoffWants,
      results: rankedResults,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    return NextResponse.json(
      {
        error: `Falha ao pesquisar posição no ranking (${msg}).`,
      },
      { status: 502 }
    );
  }
}
