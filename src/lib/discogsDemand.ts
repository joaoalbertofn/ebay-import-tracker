import { DemandFormat, TopAlbumItem } from '@/types/demand';

export interface DiscogsSearchResultItem {
  id: number;
  title?: string;
  year?: string | number;
  country?: string;
  thumb?: string;
  cover_image?: string;
  uri?: string;
  style?: string[];
  genre?: string[];
  format?: string[];
  community?: {
    want?: number;
    have?: number;
  };
}

interface CacheEntry {
  timestamp: number;
  items: TopAlbumItem[];
}

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const top100Cache = new Map<string, CacheEntry>();

// Estilos estritamente Pop que o Discogs às vezes mistura na tag "Rock" (ex: Lana Del Rey, Twenty One Pilots)
const EXCLUDED_POP_STYLES = new Set([
  'synth-pop',
  'indie pop',
  'pop rap',
  'dance-pop',
  'teen pop',
  'bubblegum',
  'europop',
  'k-pop',
  'j-pop',
  'schlager',
  'vocal',
  'chanson',
  'ballad',
]);

const EXCLUDED_POP_ARTISTS = new Set([
  'lana del rey',
  'twenty one pilots',
  'taylor swift',
  'billie eilish',
  'harry styles',
  'olivia rodrigo',
  'lorde',
  'halsey',
  'melanie martinez',
  'imagine dragons',
  'coldplay',
  'maroon 5',
]);

const VALID_ROCK_METAL_STYLE_KEYWORDS = [
  'rock',
  'metal',
  'grunge',
  'punk',
  'hardcore',
  'thrash',
  'emo',
  'industrial',
  'shoegaze',
  'post-punk',
  'new wave',
  'britpop',
  'prog',
  'grindcore',
  'crust',
  'sludge',
  'stoner',
  'doom',
  'goth',
  'mathcore',
  'metalcore',
  'deathcore',
  'djent',
  'noise',
];

// Detecta caracteres japoneses, chineses, coreanos ou cirílicos
const CJK_OR_NON_LATIN_REGEX =
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f\uac00-\ud7af\u0400-\u04ff]/;

/**
 * Remove traduções asiáticas que o Discogs concatena com "=" (ex: "Linkin Park = リンキン・パーク*" -> "Linkin Park")
 */
export function cleanDiscogsName(raw: string): string {
  return raw
    .split(' = ')[0]
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/\*+$/, '')
    .trim();
}

export function isTrueRockOrMetalRelease(
  artist: string,
  styles: string[],
  enforcedStyle: string
): boolean {
  const cleanArtist = artist.toLowerCase().trim();
  if (EXCLUDED_POP_ARTISTS.has(cleanArtist)) {
    return false;
  }

  if (enforcedStyle) {
    return true;
  }

  if (!styles || styles.length === 0) {
    return true;
  }

  const lowerStyles = styles.map((s) => s.toLowerCase().trim());

  const hasExcludedPop = lowerStyles.some((s) => EXCLUDED_POP_STYLES.has(s));
  const hasHeavyOrCoreRock = lowerStyles.some(
    (s) =>
      s.includes('metal') ||
      s.includes('grunge') ||
      s.includes('hard rock') ||
      s.includes('punk') ||
      s.includes('hardcore') ||
      s.includes('thrash') ||
      s.includes('prog') ||
      s.includes('classic rock')
  );

  if (hasExcludedPop && !hasHeavyOrCoreRock) {
    return false;
  }

  return lowerStyles.some((s) =>
    VALID_ROCK_METAL_STYLE_KEYWORDS.some((kw) => s.includes(kw))
  );
}

export function normalizeAlbumKey(str: string): string {
  return cleanDiscogsName(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(
      /\((deluxe|remaster|limited|special|anniversary|reissue|bonus|edition|expanded|digipak|japan|uk|us|eu|tour|collector|club|\d+th)[^)]*\)/gi,
      ''
    )
    .replace(/[^a-z0-9]/g, '');
}

export function splitDiscogsTitle(rawTitle: string): {
  artist: string;
  albumTitle: string;
  hasNonLatin: boolean;
} {
  const hasNonLatin = CJK_OR_NON_LATIN_REGEX.test(rawTitle);
  const parts = rawTitle.split(' - ');
  if (parts.length >= 2) {
    const artist = cleanDiscogsName(parts[0]);
    const albumTitle = cleanDiscogsName(parts.slice(1).join(' - '));
    return { artist, albumTitle, hasNonLatin };
  }
  return {
    artist: 'Artista Desconhecido',
    albumTitle: cleanDiscogsName(rawTitle),
    hasNonLatin,
  };
}

export function buildMercadoLivreNationalUrl(
  artist: string,
  albumTitle: string,
  format: DemandFormat
): string {
  const formatTerm = format === 'Vinyl' ? 'vinil lp' : 'cd';
  const raw = `${artist} ${albumTitle} ${formatTerm}`;
  const slug = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `https://lista.mercadolivre.com.br/${slug}_NoIndex_True_SHIPPING*ORIGIN_10215068`;
}

export function computeOpportunityScore(
  wants: number,
  haves: number,
  scarcityRatio: number
): number {
  if (wants < 40) return 0;
  // Combina o volume real de compradores (wants) com o peso de escassez, penalizando prensagens com mais de 4.500 Haves
  const abundancePenalty =
    haves > 5500 ? 0.35 : haves > 3500 ? 0.65 : haves > 2200 ? 0.85 : 1.0;
  const scarcityBoost = Math.pow(Math.max(0.25, Math.min(scarcityRatio, 6)), 0.85);
  return Math.round(wants * scarcityBoost * abundancePenalty);
}

export function mapDiscogsItemToTopAlbum(
  item: DiscogsSearchResultItem,
  format: DemandFormat,
  rejectNonLatin = true
): TopAlbumItem | null {
  if (!item.title) return null;

  // Ignora Singles de 1 faixa, Promos avulsos e Unofficial Releases quando a tag de formato informar
  if (Array.isArray(item.format)) {
    const fmtLower = item.format.map((f) => f.toLowerCase());
    if (
      fmtLower.includes('single') ||
      fmtLower.includes('unofficial release') ||
      fmtLower.includes('sampler') ||
      fmtLower.includes(' transcribed')
    ) {
      return null;
    }
  }

  const { artist, albumTitle, hasNonLatin } = splitDiscogsTitle(item.title);
  if (
    rejectNonLatin &&
    (hasNonLatin ||
      CJK_OR_NON_LATIN_REGEX.test(artist) ||
      CJK_OR_NON_LATIN_REGEX.test(albumTitle))
  ) {
    return null;
  }

  if (
    !artist ||
    !albumTitle ||
    artist.toLowerCase() === 'various' ||
    artist.toLowerCase() === 'unknown artist'
  ) {
    return null;
  }

  const wants = Number(item.community?.want ?? 0);
  const haves = Number(item.community?.have ?? 0);
  const scarcityRatio = Number((wants / Math.max(haves, 1)).toFixed(2));
  const opportunityScore = computeOpportunityScore(wants, haves, scarcityRatio);

  // Marca como "Clássico Mega-Abundante" apenas discos com tiragem massiva global (> 5.000 Haves e baixa razão Wants/Haves, ex: Californication, Nevermind, Ten),
  // preservando discos como Tool - Lateralus (1.546 Haves, 0.55x) que são raros e caros no Brasil!
  const isCommonClassic =
    (haves > 5000 && scarcityRatio < 0.42) ||
    (haves > 3500 && scarcityRatio < 0.25);

  const coverUrl =
    item.cover_image && !item.cover_image.endsWith('spacer.gif')
      ? item.cover_image
      : item.thumb || '';

  const ebayQuery = encodeURIComponent(`${artist} ${albumTitle} ${format}`);

  return {
    id: item.id,
    artist,
    albumTitle,
    fullTitle: `${artist} - ${albumTitle}`,
    year: item.year ? String(item.year) : undefined,
    country: item.country || undefined,
    format,
    styles: Array.isArray(item.style) ? item.style.slice(0, 4) : [],
    coverUrl,
    wants,
    haves,
    scarcityRatio,
    opportunityScore,
    isCommonClassic,
    discogsUrl: item.uri
      ? `https://www.discogs.com${item.uri}`
      : `https://www.discogs.com/search/?q=${encodeURIComponent(`${artist} ${albumTitle}`)}&type=release`,
    ebaySearchUrl: `https://www.ebay.com/sch/i.html?_nkw=${ebayQuery}`,
    mlSearchUrl: buildMercadoLivreNationalUrl(artist, albumTitle, format),
  };
}

export function resolveDiscogsAuthHeader(customHeaderToken?: string | null): {
  authHeader: string | null;
} {
  const headerToken = customHeaderToken?.trim();
  const envToken = process.env.DISCOGS_TOKEN?.trim();
  const consumerKey = process.env.DISCOGS_CONSUMER_KEY?.trim();
  const consumerSecret = process.env.DISCOGS_CONSUMER_SECRET?.trim();

  const token = headerToken || envToken;
  if (token) {
    return { authHeader: `Discogs token=${token}` };
  }
  if (consumerKey && consumerSecret) {
    return {
      authHeader: `Discogs key=${consumerKey}, secret=${consumerSecret}`,
    };
  }
  return { authHeader: null };
}

export async function getOrFetchTop100(params: {
  format: DemandFormat;
  style: string;
  authHeader: string;
  forceRefresh?: boolean;
}): Promise<{ items: TopAlbumItem[]; cached: boolean }> {
  const { format, style, authHeader, forceRefresh } = params;
  const cacheKey = `${format}::${style || 'ALL_OPPORTUNITY_V2'}`;
  const now = Date.now();

  if (!forceRefresh) {
    const cached = top100Cache.get(cacheKey);
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      return { items: cached.items, cached: true };
    }
  }

  const fetchPage = async (page: number): Promise<DiscogsSearchResultItem[]> => {
    const url = new URL('https://api.discogs.com/database/search');
    url.searchParams.set('type', 'release');
    url.searchParams.set('genre', 'Rock');
    url.searchParams.set('format', format);
    if (style) {
      url.searchParams.set('style', style);
    }
    url.searchParams.set('sort', 'want');
    url.searchParams.set('sort_order', 'desc');
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', String(page));

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: authHeader,
        'User-Agent': 'CDImportTrackerBR/1.0 +https://discogs.com',
        Accept: 'application/json',
      },
      next: { revalidate: 1800 },
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error('INVALID_DISCOGS_TOKEN');
    }

    if (!res.ok) {
      throw new Error(`DISCOGS_HTTP_${res.status}`);
    }

    const data = await res.json();
    return Array.isArray(data.results) ? data.results : [];
  };

  // Busca 4 páginas (até 400 lançamentos mais desejados) em paralelo para ter um pool rico de oportunidades e clássicos
  const [page1, page2, page3, page4] = await Promise.all([
    fetchPage(1),
    fetchPage(2).catch(() => []),
    fetchPage(3).catch(() => []),
    fetchPage(4).catch(() => []),
  ]);

  const rawResults = [...page1, ...page2, ...page3, ...page4];

  // Agrupa por Artista + Álbum mantendo também o maior Haves visto em qualquer edição daquele álbum,
  // para que uma reedição rara de "Hybrid Theory" não mascare o fato de que a edição principal de "Hybrid Theory" tem 6.790 Haves!
  const deduplicatedMap = new Map<
    string,
    { best: TopAlbumItem; maxHavesAcrossEditions: number }
  >();

  for (const item of rawResults) {
    const candidate = mapDiscogsItemToTopAlbum(item, format, true);
    if (!candidate) continue;

    if (!isTrueRockOrMetalRelease(candidate.artist, candidate.styles, style)) {
      continue;
    }

    const normKey = `${normalizeAlbumKey(candidate.artist)}::${normalizeAlbumKey(candidate.albumTitle)}`;
    if (!normKey || normKey === '::') continue;

    const existing = deduplicatedMap.get(normKey);
    if (!existing) {
      deduplicatedMap.set(normKey, {
        best: candidate,
        maxHavesAcrossEditions: candidate.haves,
      });
    } else {
      const nextMaxHaves = Math.max(
        existing.maxHavesAcrossEditions,
        candidate.haves
      );
      const bestCandidate =
        candidate.wants > existing.best.wants ? candidate : existing.best;
      deduplicatedMap.set(normKey, {
        best: bestCandidate,
        maxHavesAcrossEditions: nextMaxHaves,
      });
    }
  }

  const allUniqueAlbums = Array.from(deduplicatedMap.values()).map(
    ({ best, maxHavesAcrossEditions }) => {
      // Se alguma edição principal desse mesmo álbum tiver > 5.000 Haves, marca como clássico mega-abundante
      const effectiveCommonClassic =
        best.isCommonClassic ||
        (maxHavesAcrossEditions > 5000 &&
          best.wants / Math.max(maxHavesAcrossEditions, 1) < 0.42);
      return {
        ...best,
        isCommonClassic: effectiveCommonClassic,
        opportunityScore: effectiveCommonClassic
          ? Math.round(best.opportunityScore * 0.4)
          : best.opportunityScore,
      };
    }
  );

  const topItems = allUniqueAlbums
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .slice(0, 120);

  top100Cache.set(cacheKey, {
    timestamp: now,
    items: topItems,
  });

  return { items: topItems, cached: false };
}
