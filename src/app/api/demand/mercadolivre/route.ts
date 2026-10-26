import { NextRequest, NextResponse } from 'next/server';
import {
  BrazilMarketVerdict,
  DemandFormat,
  MercadoLivreListingSample,
  MercadoLivreOfferSummary,
} from '@/types/demand';
import { buildMercadoLivreNationalUrl } from '@/lib/discogsDemand';

const mlCache = new Map<
  string,
  { timestamp: number; summary: MercadoLivreOfferSummary }
>();
const ML_CACHE_TTL_MS = 20 * 60 * 1000;

function normalizeText(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b([a-z])\.([a-z])\.(?:([a-z])\.)?(?:([a-z])\.)?/g, '$1$2$3$4')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function computeMedian(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2));
  }
  return Number(sorted[mid].toFixed(2));
}

function computeAverage(prices: number[]): number | null {
  if (prices.length === 0) return null;
  const sum = prices.reduce((acc, p) => acc + p, 0);
  return Number((sum / prices.length).toFixed(2));
}

/**
 * Permite que o usuário cole tanto o valor puro do Cookie quanto o comando inteiro "Copy as cURL" do Chrome DevTools.
 */
function extractCleanCookie(rawInput?: string | null): string {
  if (!rawInput) return '';
  const trimmed = rawInput.trim();
  if (!trimmed) return '';

  // Caso tenha colado um comando "curl ..." do Chrome DevTools: extrai -b '...' ou -H 'cookie: ...'
  const bFlagMatch =
    trimmed.match(/(?:^|\s)-b\s+'([^']+)'/) ||
    trimmed.match(/(?:^|\s)-b\s+"([^"]+)"/) ||
    trimmed.match(/(?:^|\s)--cookie\s+'([^']+)'/) ||
    trimmed.match(/(?:^|\s)--cookie\s+"([^"]+)"/);
  if (bFlagMatch?.[1]) {
    return bFlagMatch[1].trim();
  }

  const headerMatch =
    trimmed.match(/-H\s+'cookie:\s*([^']+)'/i) ||
    trimmed.match(/-H\s+"cookie:\s*([^"]+)"/i);
  if (headerMatch?.[1]) {
    return headerMatch[1].trim();
  }

  return trimmed.replace(/^cookie:\s*/i, '').trim();
}

function parseMercadoLivreHtml(html: string): {
  isBlockedByVerification: boolean;
  reportedTotal: number;
  listings: MercadoLivreListingSample[];
} {
  // Detecta se o Mercado Livre redirecionou para a tela de verificação de conta / captcha por falta de cookie de sessão
  if (
    html.includes('gz/account-verification') ||
    html.includes('suspicious-traffic-frontend') ||
    html.includes('/captcha/wall') ||
    html.includes('bot-interceptor-muralla')
  ) {
    return {
      isBlockedByVerification: true,
      reportedTotal: 0,
      listings: [],
    };
  }

  if (
    /N[aã]o h[aá] an[uú]ncios que correspondam/i.test(html) ||
    /ui-search-rescue__title/i.test(html)
  ) {
    return {
      isBlockedByVerification: false,
      reportedTotal: 0,
      listings: [],
    };
  }

  let reportedTotal = 0;

  const qtyMatch =
    html.match(
      /ui-search-search-result__quantity-results[^>]*>\s*([\d.]+)\s*resultado/i
    ) || html.match(/"total"\s*:\s*(\d+)\s*,\s*"primary_results"/i);
  if (qtyMatch?.[1]) {
    reportedTotal = Number(qtyMatch[1].replace(/\./g, '')) || 0;
  }

  const listings: MercadoLivreListingSample[] = [];
  const seenUrls = new Set<string>();

  const cardBlocks = html.split(
    /class="[^"]*(?:ui-search-layout__item|poly-card\b)[^"]*"/i
  );

  for (let i = 1; i < cardBlocks.length; i++) {
    const block = cardBlocks[i];

    if (/compra\s+internacional|envio\s+internacional/i.test(block)) {
      continue;
    }

    const titleAnchorMatch =
      block.match(
        /<a[^>]+href="([^"]+)"[^>]*class="[^"]*poly-component__title[^"]*"[^>]*>([\s\S]*?)<\/a>/i
      ) ||
      block.match(
        /<a[^>]+class="[^"]*poly-component__title[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i
      ) ||
      block.match(
        /<a[^>]+href="([^"]+)"[^>]*class="[^"]*ui-search-link__title-card[^"]*"[^>]*>([\s\S]*?)<\/a>/i
      );

    let permalink = '';
    let rawTitle = '';

    if (titleAnchorMatch) {
      if (titleAnchorMatch[1].startsWith('http')) {
        permalink = decodeHtmlEntities(titleAnchorMatch[1].split('#')[0]);
        rawTitle = decodeHtmlEntities(
          titleAnchorMatch[2].replace(/<[^>]+>/g, '').trim()
        );
      } else {
        rawTitle = decodeHtmlEntities(
          titleAnchorMatch[1].replace(/<[^>]+>/g, '').trim()
        );
        permalink = decodeHtmlEntities(titleAnchorMatch[2].split('#')[0]);
      }
    } else {
      const h2Match = block.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/i);
      const hrefMatch = block.match(
        /href="(https:\/\/(?:produto|www|click1)\.mercadolivre\.com\.br\/[^"#]+)"/i
      );
      if (h2Match && hrefMatch) {
        rawTitle = decodeHtmlEntities(
          h2Match[1].replace(/<[^>]+>/g, '').trim()
        );
        permalink = decodeHtmlEntities(hrefMatch[1]);
      }
    }

    if (!rawTitle || !permalink || seenUrls.has(permalink)) continue;

    const cleanedForPrice = block
      .replace(
        /<s\b[^>]*class="[^"]*andes-money-amount--previous[^"]*"[\s\S]*?<\/s>/gi,
        ''
      )
      .replace(
        /<span[^>]*class="[^"]*poly-price__installments[^"]*"[\s\S]*?<\/span>/gi,
        ''
      );

    const fractionMatch = cleanedForPrice.match(
      /class="[^"]*andes-money-amount__fraction[^"]*"[^>]*>([\d.]+)<\/span>(?:\s*<span[^>]*>,<\/span>\s*<span[^>]*class="[^"]*andes-money-amount__cents[^"]*"[^>]*>(\d+)<\/span>)?/i
    );

    if (!fractionMatch) continue;
    const intPart = Number(fractionMatch[1].replace(/\./g, ''));
    const centsPart = fractionMatch[2] ? Number(fractionMatch[2]) / 100 : 0;
    const price = Number((intPart + centsPart).toFixed(2));

    if (!Number.isFinite(price) || price <= 10) continue;

    seenUrls.add(permalink);
    listings.push({
      id: `ml-${listings.length + 1}`,
      title: rawTitle,
      price,
      permalink,
    });
  }

  if (listings.length === 0) {
    const jsonCardRegex =
      /"title"\s*:\s*\{\s*"text"\s*:\s*"([^"]+)"[\s\S]{1,1200}?"current_price"\s*:\s*\{\s*"value"\s*:\s*([\d.]+)/gi;
    let match: RegExpExecArray | null;
    while ((match = jsonCardRegex.exec(html)) !== null) {
      const title = decodeHtmlEntities(match[1]);
      const price = Number(Number(match[2]).toFixed(2));
      if (title && Number.isFinite(price) && price > 10) {
        listings.push({
          id: `ml-json-${listings.length + 1}`,
          title,
          price,
          permalink: '',
        });
      }
    }
  }

  return {
    isBlockedByVerification: false,
    reportedTotal,
    listings,
  };
}

function matchesTargetAlbum(
  listingTitle: string,
  artist: string,
  album: string,
  format: DemandFormat
): boolean {
  const normTitle = normalizeText(listingTitle);
  const normArtist = normalizeText(artist);
  const normAlbum = normalizeText(album)
    .replace(
      /\b(the|and|of|in|on|at|to|for|a|an|vol|edition|deluxe|remaster|anniversary|chapters)\b/g,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();

  if (
    /\b(lote|colecao|discografia|set\s+\d+\s+items|\d+\s*cds|\bkit\b|camiseta|dvd|blu\s*ray|bluray|livro|poster|k7|cassete|patch|botton|adesivo)\b/i.test(
      normTitle
    )
  ) {
    return false;
  }

  if (format === 'CD') {
    if (/\b(vinil|vinyl|\blp\b|\d+\s*lps\b|vitrola)\b/i.test(normTitle)) {
      return false;
    }
  } else {
    if (
      /\bcd\b/i.test(normTitle) &&
      !/\b(vinil|vinyl|\blp\b)\b/i.test(normTitle)
    ) {
      return false;
    }
  }

  const titleWords = new Set(normTitle.split(' ').filter(Boolean));

  const artistWords = normArtist.split(' ').filter((w) => w.length >= 2);
  if (artistWords.length > 0) {
    const hasArtist = artistWords.every((w) =>
      w.length <= 3 ? titleWords.has(w) : normTitle.includes(w)
    );
    if (!hasArtist) return false;
  }

  const albumWords = normAlbum.split(' ').filter((w) => w.length >= 2);
  if (albumWords.length > 0) {
    const matchedAlbumWords = albumWords.filter((w) =>
      w.length <= 3 ? titleWords.has(w) : normTitle.includes(w)
    );
    const requiredMatches =
      albumWords.length <= 2
        ? albumWords.length
        : Math.ceil(albumWords.length * 0.7);
    if (matchedAlbumWords.length < requiredMatches) {
      return false;
    }
  }

  return true;
}

function filterPriceOutliers<T extends { price: number }>(items: T[]): T[] {
  if (items.length <= 2) return items;
  const sortedPrices = items.map((i) => i.price).sort((a, b) => a - b);
  const median = computeMedian(sortedPrices) || sortedPrices[0];

  const minAllowed = median * 0.4;
  const maxAllowed = median * 2.1;

  const filtered = items.filter(
    (i) => i.price >= minAllowed && i.price <= maxAllowed
  );
  return filtered.length > 0 ? filtered : items;
}

function evaluateBrazilVerdict(params: {
  matchedCount: number;
  lowestPrice: number | null;
  avgPrice: number | null;
}): {
  verdict: BrazilMarketVerdict;
  verdictLabel: string;
  verdictReason: string;
} {
  const { matchedCount, lowestPrice, avgPrice } = params;

  if (matchedCount === 0 || avgPrice === null || lowestPrice === null) {
    return {
      verdict: 'white_whale',
      verdictLabel: '🟣 RARO NO BRASIL (0 à venda no ML)',
      verdictReason:
        'Nenhuma cópia nacional encontrada à venda no Mercado Livre! Altíssimo potencial para importar e vender sem concorrência.',
    };
  }

  if (matchedCount <= 4) {
    return {
      verdict: 'opportunity',
      verdictLabel: `🟢 MUITO RARO NO BR (Só ${matchedCount} no ML)`,
      verdictReason: `Escassez no Brasil: apenas ${matchedCount} un. à venda (Média R$ ${Math.round(avgPrice)} / Mín. R$ ${Math.round(lowestPrice)}). Excelente para importar!`,
    };
  }

  if (
    (matchedCount <= 8 && avgPrice >= 115) ||
    (matchedCount <= 14 && avgPrice >= 145 && lowestPrice >= 115)
  ) {
    return {
      verdict: 'opportunity',
      verdictLabel: '🟢 OPORTUNIDADE BR (Caro / Escasso no ML)',
      verdictReason:
        matchedCount <= 6
          ? `Pouca oferta no Brasil (${matchedCount} un.) com preço médio alto (R$ ${Math.round(avgPrice)}). Ótima margem!`
          : `Vendido caro no Brasil (Média R$ ${Math.round(avgPrice)} / Mín. R$ ${Math.round(lowestPrice)}). Compensa importar mais barato!`,
    };
  }

  if (matchedCount > 14 || lowestPrice < 85 || avgPrice < 105) {
    return {
      verdict: 'saturated',
      verdictLabel: '🔴 JÁ COMUM / BARATO NO BR',
      verdictReason:
        lowestPrice < 85
          ? `Já vendido barato no Brasil (a partir de R$ ${Math.round(lowestPrice)} • ${matchedCount} un.). Margem baixa p/ importar.`
          : `Alta oferta nacional (${matchedCount} anúncios deste álbum). Concorrência elevada no ML.`,
    };
  }

  return {
    verdict: 'competitive',
    verdictLabel: `🟡 OFERTA MODERADA NO BR (${matchedCount} no ML)`,
    verdictReason: `${matchedCount} un. no Brasil com média de R$ ${Math.round(avgPrice)}. Compensa se garimpar barato em leilão/lote no exterior.`,
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const artist = (searchParams.get('artist') || '').trim();
  const album = (searchParams.get('album') || '').trim();
  const formatParam = (searchParams.get('format') || 'CD') as DemandFormat;
  const format: DemandFormat = formatParam === 'Vinyl' ? 'Vinyl' : 'CD';

  if (!artist || !album) {
    return NextResponse.json(
      { error: 'Parâmetros artist e album são obrigatórios.' },
      { status: 400 }
    );
  }

  const mlCookie = extractCleanCookie(
    request.headers.get('x-ml-cookie') || process.env.MERCADOLIVRE_COOKIE
  );

  const formatLabel = format === 'Vinyl' ? 'Vinil LP' : 'CD';
  const query = `${artist} ${album} ${formatLabel}`.trim();
  const searchUrl = buildMercadoLivreNationalUrl(artist, album, format);

  const cacheKey = `V4::${Boolean(mlCookie)}::${format}::${normalizeText(artist)}::${normalizeText(album)}`;
  const cached = mlCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < ML_CACHE_TTL_MS) {
    return NextResponse.json(cached.summary);
  }

  try {
    const reqHeaders: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'Cache-Control': 'no-cache',
    };

    if (mlCookie) {
      reqHeaders.Cookie = mlCookie;
    }

    const res = await fetch(searchUrl, {
      headers: reqHeaders,
      redirect: 'follow',
      next: { revalidate: 900 },
    });

    // Quando não há nenhum resultado nacional, o Mercado Livre retorna HTTP 404 na página de busca
    if (res.status === 404) {
      const zeroVerdict = evaluateBrazilVerdict({
        matchedCount: 0,
        lowestPrice: null,
        avgPrice: null,
      });
      const zeroSummary: MercadoLivreOfferSummary = {
        query,
        totalActiveListings: 0,
        matchedAlbumCount: 0,
        lowestPriceBrl: null,
        averagePriceBrl: null,
        medianPriceBrl: null,
        highestPriceBrl: null,
        ...zeroVerdict,
        searchUrl,
        topItems: [],
      };
      mlCache.set(cacheKey, { timestamp: Date.now(), summary: zeroSummary });
      return NextResponse.json(zeroSummary);
    }

    const html = await res.text();
    const { isBlockedByVerification, reportedTotal, listings } =
      parseMercadoLivreHtml(html);

    // Se o Mercado Livre redirecionou o servidor para /gz/account-verification por falta do Cookie da sessão logada do navegador:
    if (
      isBlockedByVerification ||
      res.url.includes('account-verification') ||
      res.url.includes('captcha')
    ) {
      return NextResponse.json({
        query,
        totalActiveListings: 0,
        matchedAlbumCount: 0,
        lowestPriceBrl: null,
        averagePriceBrl: null,
        medianPriceBrl: null,
        highestPriceBrl: null,
        verdict: 'competitive',
        verdictLabel: '🔒 Conecte sua Sessão do ML (1 clique)',
        verdictReason:
          'O Mercado Livre exigiu o Cookie da sua aba logada para liberar os preços automaticamente. Clique em "Conectar Sessão ML" no topo da tela!',
        searchUrl,
        topItems: [],
        requiresMlSession: true,
      } satisfies MercadoLivreOfferSummary);
    }

    const matchedListings = listings.filter((item) =>
      matchesTargetAlbum(item.title, artist, album, format)
    );

    const cleanListings = filterPriceOutliers(matchedListings);

    const sortedPrices = cleanListings
      .map((i) => i.price)
      .sort((a, b) => a - b);

    const lowestPriceBrl = sortedPrices.length > 0 ? sortedPrices[0] : null;
    const averagePriceBrl = computeAverage(sortedPrices);
    const medianPriceBrl = computeMedian(sortedPrices);
    const highestPriceBrl =
      sortedPrices.length > 0 ? sortedPrices[sortedPrices.length - 1] : null;

    const { verdict, verdictLabel, verdictReason } = evaluateBrazilVerdict({
      matchedCount: matchedListings.length,
      lowestPrice: lowestPriceBrl,
      avgPrice: averagePriceBrl,
    });

    const summary: MercadoLivreOfferSummary = {
      query,
      totalActiveListings: reportedTotal || listings.length,
      matchedAlbumCount: matchedListings.length,
      lowestPriceBrl,
      averagePriceBrl,
      medianPriceBrl,
      highestPriceBrl,
      verdict,
      verdictLabel,
      verdictReason,
      searchUrl,
      topItems: cleanListings.slice(0, 3),
    };

    mlCache.set(cacheKey, { timestamp: Date.now(), summary });
    return NextResponse.json(summary);
  } catch {
    const fallback: MercadoLivreOfferSummary = {
      query,
      totalActiveListings: 0,
      matchedAlbumCount: 0,
      lowestPriceBrl: null,
      averagePriceBrl: null,
      medianPriceBrl: null,
      highestPriceBrl: null,
      verdict: 'competitive',
      verdictLabel: 'Abrir Busca Nacional no ML',
      verdictReason:
        'Não foi possível ler os anúncios automaticamente agora. Clique em "Abrir ML" para ver os anúncios ativos.',
      searchUrl,
      topItems: [],
    };
    return NextResponse.json(fallback);
  }
}
