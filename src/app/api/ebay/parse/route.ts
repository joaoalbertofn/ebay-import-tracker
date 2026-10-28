import { NextRequest, NextResponse } from 'next/server';
import {
  EbayImportResult,
  ParsedEbayCDItem,
  extractEbayListingUrls,
  extractEbayOrderInfo,
  parseEbayListingTitle,
  parseEbayOrderCopiedText,
  parsePriceAndCurrency,
} from '@/lib/ebayImport';
import { CurrencyCode } from '@/types/tracker';

function detectCurrencyFromDomain(url: string): CurrencyCode | undefined {
  if (/ebay\.co\.uk/i.test(url)) return 'GBP';
  if (/ebay\.(?:de|fr|it|es|nl|ie|at|be)/i.test(url)) return 'EUR';
  if (/ebay\.com/i.test(url)) return 'USD';
  return undefined;
}

function extractSlugTitleFromUrl(url: string): string | null {
  const m = url.match(/\/itm\/([^/?#]+)\/\d+/i);
  if (!m || !m[1]) return null;
  const slug = decodeURIComponent(m[1]).replace(/[-_]+/g, ' ').trim();
  if (/^\d+$/.test(slug) || slug.length < 3) return null;
  return slug;
}

async function fetchPublicEbayListing(
  url: string
): Promise<ParsedEbayCDItem | null> {
  const fallbackCurrency = detectCurrencyFromDomain(url);
  const slugTitle = extractSlugTitleFromUrl(url);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8,pt-BR;q=0.7',
      },
      redirect: 'follow',
    });

    clearTimeout(timeout);

    const finalUrl = res.url || url;
    const resolvedCurrency =
      detectCurrencyFromDomain(finalUrl) || fallbackCurrency;

    if (!res.ok) {
      if (slugTitle) {
        const parsed = parseEbayListingTitle(slugTitle);
        return {
          rawTitle: slugTitle,
          artist: parsed.artist,
          albumTitle: parsed.albumTitle,
          discCount: parsed.discCount,
          releaseYear: parsed.releaseYear,
          currency: resolvedCurrency,
          ebayListingUrl: finalUrl,
        };
      }
      return null;
    }

    const html = await res.text();

    let rawTitle = '';
    let unitPrice: number | undefined;
    let currency: CurrencyCode | undefined = resolvedCurrency;
    let shippingPrice: number | undefined;
    let coverUrl: string | undefined;

    // 1. Tenta ler JSON-LD de Produto se presente
    const ldMatches = html.match(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    );
    if (ldMatches) {
      for (const block of ldMatches) {
        const inner = block
          .replace(/^<script[^>]*>/i, '')
          .replace(/<\/script>$/i, '')
          .trim();
        try {
          const data = JSON.parse(inner);
          const candidates = Array.isArray(data) ? data : [data];
          for (const item of candidates) {
            if (
              item &&
              (item['@type'] === 'Product' ||
                item['@type']?.includes?.('Product'))
            ) {
              if (item.name && !rawTitle) rawTitle = String(item.name);
              if (item.image && !coverUrl) {
                coverUrl = Array.isArray(item.image)
                  ? String(item.image[0])
                  : String(item.image);
              }
              const offers = Array.isArray(item.offers)
                ? item.offers[0]
                : item.offers;
              if (offers) {
                if (offers.price !== undefined && unitPrice === undefined) {
                  const p = parseFloat(String(offers.price));
                  if (!Number.isNaN(p)) unitPrice = p;
                }
                if (offers.priceCurrency) {
                  const curr = String(offers.priceCurrency).toUpperCase();
                  if (
                    curr === 'GBP' ||
                    curr === 'USD' ||
                    curr === 'EUR' ||
                    curr === 'JPY' ||
                    curr === 'BRL'
                  ) {
                    currency = curr as CurrencyCode;
                  }
                }
              }
            }
          }
        } catch {
          // ignora JSON inválido
        }
      }
    }

    // 2. Fallback para Meta Tags (og:title, twitter:title, title)
    if (!rawTitle) {
      const ogTitleMatch =
        html.match(
          /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
        ) ||
        html.match(
          /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i
        );
      if (ogTitleMatch) {
        rawTitle = ogTitleMatch[1];
      }
    }

    if (!rawTitle) {
      const titleTagMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleTagMatch) {
        rawTitle = titleTagMatch[1];
      }
    }

    // Remove sufixos "| eBay"
    rawTitle = rawTitle
      .replace(/\s*\|\s*eBay.*$/i, '')
      .replace(/for sale online\s*$/i, '')
      .trim();

    if (!rawTitle && slugTitle) {
      rawTitle = slugTitle;
    }

    // 3. Fallback para Preço no HTML se JSON-LD não trouxe
    if (unitPrice === undefined) {
      const priceBlockMatch =
        html.match(/class=["'][^"']*x-price-primary[^"']*["'][\s\S]{0,300}?<span[^>]*>([^<]+)<\/span>/i) ||
        html.match(/itemprop=["']price["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/["']price["']\s*:\s*["'](\d+(?:\.\d{1,2})?)["']/i);

      if (priceBlockMatch) {
        const parsedP = parsePriceAndCurrency(priceBlockMatch[1]);
        if (parsedP.amount !== undefined) {
          unitPrice = parsedP.amount;
          if (parsedP.currency) currency = parsedP.currency;
        } else {
          const directFloat = parseFloat(priceBlockMatch[1].replace(',', '.'));
          if (!Number.isNaN(directFloat)) unitPrice = directFloat;
        }
      }
    }

    // 4. Fallback para Imagem no og:image
    if (!coverUrl) {
      const ogImgMatch =
        html.match(
          /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
        ) ||
        html.match(
          /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i
        );
      if (ogImgMatch && ogImgMatch[1].startsWith('http')) {
        coverUrl = ogImgMatch[1];
      }
    }

    // 5. Tenta extrair Frete Local (Postage / Shipping)
    const shippingSectionMatch = html.match(
      /ux-labels-values--shipping[\s\S]{0,1200}?ux-labels-values__values[\s\S]{0,600}?<\/div>/i
    );
    if (shippingSectionMatch) {
      const shipBlock = shippingSectionMatch[0]
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ');
      if (/\bfree\b|\bgr[aá]tis\b/i.test(shipBlock)) {
        shippingPrice = 0;
      } else {
        const parsedShip = parsePriceAndCurrency(shipBlock);
        if (parsedShip.amount !== undefined) {
          shippingPrice = parsedShip.amount;
        }
      }
    }

    if (!rawTitle) {
      return null;
    }

    const parsedTitle = parseEbayListingTitle(rawTitle);

    return {
      rawTitle,
      artist: parsedTitle.artist,
      albumTitle: parsedTitle.albumTitle,
      discCount: parsedTitle.discCount,
      releaseYear: parsedTitle.releaseYear,
      unitPrice,
      currency,
      shippingPrice,
      coverUrl,
      ebayListingUrl: finalUrl,
    };
  } catch {
    if (slugTitle) {
      const parsed = parseEbayListingTitle(slugTitle);
      return {
        rawTitle: slugTitle,
        artist: parsed.artist,
        albumTitle: parsed.albumTitle,
        discCount: parsed.discCount,
        releaseYear: parsed.releaseYear,
        currency: fallbackCurrency,
        ebayListingUrl: url,
      };
    }
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const input = typeof body?.input === 'string' ? body.input.trim() : '';

    if (!input) {
      return NextResponse.json(
        { error: 'Cole o link do anúncio, link do pedido ou texto do pedido.' },
        { status: 400 }
      );
    }

    // 1. Extrai dados do Pedido (Order ID / URL) se presentes
    const orderInfo = extractEbayOrderInfo(input);

    // 2. Extrai links públicos de anúncios (/itm/... ou ebay.us/...)
    const listingUrls = extractEbayListingUrls(input).slice(0, 10);

    const fetchedItems: ParsedEbayCDItem[] = [];
    if (listingUrls.length > 0) {
      const results = await Promise.all(
        listingUrls.map((u) => fetchPublicEbayListing(u))
      );
      for (const r of results) {
        if (r) fetchedItems.push(r);
      }
    }

    // 3. Se também houver texto copiado do pedido (ou se não havia links /itm/), analisa o texto
    const textParsed = parseEbayOrderCopiedText(input);

    const combinedItems =
      fetchedItems.length > 0 ? fetchedItems : textParsed.items;

    const detectedCurrency =
      fetchedItems.find((i) => i.currency)?.currency || textParsed.currency;

    const detectedShipping =
      textParsed.internalShipping !== undefined
        ? textParsed.internalShipping
        : fetchedItems.length > 0 &&
          fetchedItems.some((i) => i.shippingPrice !== undefined)
        ? fetchedItems.reduce((acc, i) => acc + (i.shippingPrice || 0), 0)
        : undefined;

    const warnings: string[] = [];
    if (
      (orderInfo.ebayOrderId || orderInfo.ebayOrderUrl) &&
      combinedItems.length === 0 &&
      listingUrls.length === 0
    ) {
      warnings.push(
        `Pedido #${orderInfo.ebayOrderId || ''} vinculado! Como a página de pedido do eBay é privada (exige login), para puxar os CDs automaticamente cole também o link do anúncio (ebay.com/itm/...) ou copie e cole o texto da página do pedido aqui.`
      );
    } else if (listingUrls.length > 0 && combinedItems.length === 0) {
      warnings.push(
        'Não foi possível ler os detalhes públicos deste link automaticamente. Você pode colar o título/texto do anúncio diretamente neste campo.'
      );
    }

    const responsePayload: EbayImportResult = {
      ebayOrderId: orderInfo.ebayOrderId || textParsed.ebayOrderId,
      ebayOrderUrl: orderInfo.ebayOrderUrl || textParsed.ebayOrderUrl,
      currency: detectedCurrency,
      internalShipping: detectedShipping,
      localTrackingCode: textParsed.localTrackingCode,
      items: combinedItems,
      warnings: warnings.length > 0 ? warnings : undefined,
    };

    return NextResponse.json(responsePayload);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Erro ao processar dados do eBay.',
      },
      { status: 500 }
    );
  }
}
