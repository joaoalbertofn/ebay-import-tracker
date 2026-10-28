import { NextRequest, NextResponse } from 'next/server';
import {
  EbayImportResult,
  ParsedEbayCDItem,
  extractArtistFromBundleTitle,
  extractEbayItemIds,
  extractEbayListingUrls,
  extractEbayOrderInfo,
  extractNumberedAlbumsFromDescription,
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

function isAntiBotTitle(title: string): boolean {
  if (!title) return true;
  return /pardon\s+our\s+interruption|security\s+measure|access\s+denied|just\s+a\s+moment|attention\s+required|robot\s+check|^ebay$/i.test(
    title.trim()
  );
}

function htmlToPlainTextWithLines(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(?:br|p|div|li|tr|h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Busca a descrição do vendedor no endpoint dedicado de descrição do eBay (vi.vipr.ebaydesc.com)
 */
async function fetchSellerDescriptionByItemId(itemId: string): Promise<string> {
  const descUrls = [
    `https://vi.vipr.ebaydesc.com/ws/eBayISAPI.dll?ViewItemDescV4&item=${itemId}`,
    `https://itm.ebaydesc.com/itmdesc/${itemId}`,
  ];

  for (const descUrl of descUrls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5500);
      const res = await fetch(descUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,*/*',
        },
      });
      clearTimeout(timeout);

      if (res.ok) {
        const html = await res.text();
        const text = htmlToPlainTextWithLines(html);
        if (
          text.length > 15 &&
          !/pardon\s+our\s+interruption/i.test(text)
        ) {
          return text;
        }
      }
    } catch {
      // tenta próximo endpoint
    }
  }
  return '';
}

/**
 * Fallback via Jina Reader / Microlink quando o IP da Vercel recebe bloqueio anti-bot do www.ebay.com
 */
async function fetchListingViaReaderFallback(
  url: string,
  itemId?: string
): Promise<{
  rawTitle?: string;
  price?: number;
  currency?: CurrencyCode;
  shippingPrice?: number;
  artistSpecific?: string;
  descriptionText?: string;
  coverUrl?: string;
}> {
  const candidateUrls = itemId
    ? [`https://www.ebay.co.uk/itm/${itemId}`, url]
    : [url];

  for (const targetUrl of candidateUrls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7500);
      const readerUrl = `https://r.jina.ai/${targetUrl}`;
      const res = await fetch(readerUrl, {
        signal: controller.signal,
        headers: {
          Accept: 'text/plain',
          'X-Return-Format': 'text',
        },
      });
      clearTimeout(timeout);

      if (!res.ok) continue;
      const text = await res.text();
      if (!text || /pardon\s+our\s+interruption/i.test(text)) continue;

      let rawTitle: string | undefined;
      const titleLine = text.match(/^Title:\s*(.+)$/m);
      if (titleLine) {
        const cleanT = titleLine[1]
          .replace(/\s*\|\s*eBay.*$/i, '')
          .replace(/for sale online\s*$/i, '')
          .trim();
        if (!isAntiBotTitle(cleanT)) {
          rawTitle = cleanT;
        }
      }

      const parsedFromReader = parseEbayOrderCopiedText(text);
      return {
        rawTitle,
        price: parsedFromReader.bundleTotalValue,
        currency: parsedFromReader.currency,
        shippingPrice: parsedFromReader.internalShipping,
        descriptionText: text,
      };
    } catch {
      // continua
    }
  }

  // Fallback extra: Microlink OpenGraph metadata
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const mlRes = await fetch(
      `https://api.microlink.io/?url=${encodeURIComponent(url)}`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (mlRes.ok) {
      const mlJson = await mlRes.json();
      const t = String(mlJson?.data?.title || '')
        .replace(/\s*\|\s*eBay.*$/i, '')
        .trim();
      const desc = String(mlJson?.data?.description || '');
      const img = mlJson?.data?.image?.url;
      if (t && !isAntiBotTitle(t)) {
        const pInfo = parsePriceAndCurrency(`${t} ${desc}`);
        return {
          rawTitle: t,
          price: pInfo.amount,
          currency: pInfo.currency,
          coverUrl: typeof img === 'string' ? img : undefined,
          descriptionText: desc,
        };
      }
    }
  } catch {
    // ignora
  }

  return {};
}

async function fetchPublicEbayListingItems(url: string): Promise<{
  items: ParsedEbayCDItem[];
  currency?: CurrencyCode;
  shippingPrice?: number;
  bundleTotalValue?: number;
}> {
  const fallbackCurrency = detectCurrencyFromDomain(url);
  const slugTitle = extractSlugTitleFromUrl(url);
  const itemId = extractEbayItemIds(url)[0];

  // Dispara busca da descrição do vendedor em paralelo (caso seja um bundle com lista de álbuns!)
  const sellerDescPromise = itemId
    ? fetchSellerDescriptionByItemId(itemId)
    : Promise.resolve('');

  let rawTitle = '';
  let unitPrice: number | undefined;
  let currency: CurrencyCode | undefined = fallbackCurrency;
  let shippingPrice: number | undefined;
  let coverUrl: string | undefined;
  let pagePlainText = '';
  let finalUrl = url;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6500);

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
    finalUrl = res.url || url;
    currency = detectCurrencyFromDomain(finalUrl) || fallbackCurrency;

    if (res.ok) {
      const html = await res.text();
      pagePlainText = htmlToPlainTextWithLines(html);

      // 1. JSON-LD
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
                if (item.name && !rawTitle && !isAntiBotTitle(String(item.name))) {
                  rawTitle = String(item.name);
                }
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
            // ignora
          }
        }
      }

      // 2. Meta tags / Title
      if (!rawTitle) {
        const ogTitleMatch =
          html.match(
            /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
          ) ||
          html.match(
            /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i
          );
        if (ogTitleMatch && !isAntiBotTitle(ogTitleMatch[1])) {
          rawTitle = ogTitleMatch[1];
        }
      }

      if (!rawTitle) {
        const titleTagMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleTagMatch) {
          const candidateTitle = titleTagMatch[1]
            .replace(/\s*\|\s*eBay.*$/i, '')
            .replace(/for sale online\s*$/i, '')
            .trim();
          if (!isAntiBotTitle(candidateTitle)) {
            rawTitle = candidateTitle;
          }
        }
      }

      rawTitle = rawTitle
        .replace(/\s*\|\s*eBay.*$/i, '')
        .replace(/for sale online\s*$/i, '')
        .trim();

      if (isAntiBotTitle(rawTitle)) {
        rawTitle = '';
      }

      // 3. Preço no HTML
      if (unitPrice === undefined && rawTitle) {
        const priceBlockMatch =
          html.match(
            /class=["'][^"']*x-price-primary[^"']*["'][\s\S]{0,300}?<span[^>]*>([^<]+)<\/span>/i
          ) ||
          html.match(/itemprop=["']price["'][^>]+content=["']([^"']+)["']/i) ||
          html.match(/["']binPrice["']\s*:\s*["']([^"']+)["']/i) ||
          html.match(/["']price["']\s*:\s*["'](\d+(?:\.\d{1,2})?)["']/i);

        if (priceBlockMatch) {
          const parsedP = parsePriceAndCurrency(priceBlockMatch[1]);
          if (parsedP.amount !== undefined) {
            unitPrice = parsedP.amount;
            if (parsedP.currency) currency = parsedP.currency;
          } else {
            const directFloat = parseFloat(
              priceBlockMatch[1].replace(',', '.')
            );
            if (!Number.isNaN(directFloat)) unitPrice = directFloat;
          }
        }
      }

      // 4. Imagem og:image
      if (!coverUrl && rawTitle) {
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

      // 5. Frete Local
      if (rawTitle) {
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
      }
    }
  } catch {
    // continua para fallbacks
  }

  // Se o eBay bloqueou a requisição direta com "Pardon Our Interruption", aciona o Reader Fallback
  if (!rawTitle) {
    const fallbackData = await fetchListingViaReaderFallback(url, itemId);
    if (fallbackData.rawTitle) rawTitle = fallbackData.rawTitle;
    if (fallbackData.price !== undefined && unitPrice === undefined) {
      unitPrice = fallbackData.price;
    }
    if (fallbackData.currency) currency = fallbackData.currency;
    if (fallbackData.shippingPrice !== undefined && shippingPrice === undefined) {
      shippingPrice = fallbackData.shippingPrice;
    }
    if (fallbackData.coverUrl && !coverUrl) coverUrl = fallbackData.coverUrl;
    if (fallbackData.descriptionText) {
      pagePlainText = `${pagePlainText}\n${fallbackData.descriptionText}`;
    }
  }

  const sellerDescText = await sellerDescPromise;
  const combinedDescriptionText = `${sellerDescText}\n${pagePlainText}`.trim();

  if (!rawTitle && slugTitle) {
    rawTitle = slugTitle;
  }

  // Tenta descobrir o artista pela descrição ou pelo título (ex: "HIM 7 album cd bundle" -> "HIM")
  const inferredArtist =
    extractArtistFromBundleTitle(rawTitle) ||
    extractArtistFromBundleTitle(sellerDescText);

  // Verifica se a descrição do vendedor contém a lista numerada dos álbuns do lote (ex: 1. Love Metal, 2. Dark Light...)
  const descriptionAlbums = extractNumberedAlbumsFromDescription(
    combinedDescriptionText,
    inferredArtist
  );

  if (descriptionAlbums.length >= 2) {
    const unitEach =
      unitPrice !== undefined
        ? Number((unitPrice / descriptionAlbums.length).toFixed(4))
        : undefined;

    return {
      currency,
      shippingPrice,
      bundleTotalValue: unitPrice,
      items: descriptionAlbums.map((item) => ({
        ...item,
        artist: item.artist || inferredArtist,
        unitPrice: unitEach,
        currency,
        ebayListingUrl: finalUrl,
      })),
    };
  }

  if (!rawTitle) {
    return { items: [] };
  }

  const parsedTitle = parseEbayListingTitle(rawTitle, inferredArtist);

  // Se o título indicar que é um Bundle de N CDs (ex: "HIM CD/DVD ALBUM 6 BUNDLE"), mas não havia lista numerada na descrição
  if (parsedTitle.isBundleTitle) {
    const count = parsedTitle.bundleCount || 2;
    const artistName = parsedTitle.artist || inferredArtist || '';
    const unitEach =
      unitPrice !== undefined
        ? Number((unitPrice / count).toFixed(4))
        : undefined;

    const generatedBundleItems: ParsedEbayCDItem[] = [];
    for (let i = 0; i < count; i++) {
      generatedBundleItems.push({
        rawTitle,
        artist: artistName,
        albumTitle: `CD #${i + 1} do Lote${artistName ? ` (${artistName})` : ''}`,
        discCount: 1,
        unitPrice: unitEach,
        currency,
        shippingPrice: i === 0 ? shippingPrice : 0,
        coverUrl: i === 0 ? coverUrl : undefined,
        ebayListingUrl: finalUrl,
      });
    }

    return {
      currency,
      shippingPrice,
      bundleTotalValue: unitPrice,
      items: generatedBundleItems,
    };
  }

  return {
    currency,
    shippingPrice,
    bundleTotalValue: unitPrice,
    items: [
      {
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
      },
    ],
  };
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

    // Se o usuário colou o texto da página do pedido e nela havia um "Item ID: 840062942035", também busca a descrição do anúncio!
    const itemIdsInText = extractEbayItemIds(input);
    if (listingUrls.length === 0 && itemIdsInText.length > 0) {
      for (const id of itemIdsInText.slice(0, 3)) {
        listingUrls.push(`https://www.ebay.co.uk/itm/${id}`);
      }
    }

    // 3. Analisa texto colado (caso o usuário tenha copiado o texto do pedido ou a descrição do anúncio)
    const textParsed = parseEbayOrderCopiedText(input);

    const fetchedItems: ParsedEbayCDItem[] = [];
    let fetchedCurrency: CurrencyCode | undefined;
    let fetchedShipping: number | undefined;
    let fetchedBundleTotal: number | undefined;

    // Se o texto colado já continha os álbuns numerados da descrição (ex: 1. Love Metal, 2. Dark Light...), usa direto!
    const textHasDetailedAlbums =
      textParsed.items.length >= 2 &&
      textParsed.items.every((i) => !i.albumTitle.startsWith('CD #'));

    if (!textHasDetailedAlbums && listingUrls.length > 0) {
      const results = await Promise.all(
        listingUrls.map((u) => fetchPublicEbayListingItems(u))
      );
      for (const r of results) {
        if (r.items.length > 0) {
          fetchedItems.push(...r.items);
        }
        if (r.currency && !fetchedCurrency) fetchedCurrency = r.currency;
        if (r.shippingPrice !== undefined) {
          fetchedShipping = (fetchedShipping || 0) + r.shippingPrice;
        }
        if (r.bundleTotalValue !== undefined) {
          fetchedBundleTotal = (fetchedBundleTotal || 0) + r.bundleTotalValue;
        }
      }
    }

    const combinedItems =
      fetchedItems.length > 0 ? fetchedItems : textParsed.items;

    const detectedCurrency =
      textParsed.currency ||
      fetchedCurrency ||
      combinedItems.find((i) => i.currency)?.currency;

    const detectedShipping =
      textParsed.internalShipping !== undefined
        ? textParsed.internalShipping
        : fetchedShipping;

    const detectedBundleTotal =
      textParsed.bundleTotalValue ?? fetchedBundleTotal;

    // Se o texto do pedido tinha o preço real pago (ex: GBP 18.00) e o anúncio trouxe os 7 álbuns da descrição, garante o rateio do preço pago entre os álbuns!
    if (
      detectedBundleTotal !== undefined &&
      detectedBundleTotal > 0 &&
      combinedItems.length > 1
    ) {
      const hasAnyPrice = combinedItems.some(
        (i) => i.unitPrice !== undefined && i.unitPrice > 0
      );
      if (!hasAnyPrice) {
        const unitVal = Number(
          (detectedBundleTotal / combinedItems.length).toFixed(4)
        );
        combinedItems.forEach((item) => {
          item.unitPrice = unitVal;
        });
      }
    }

    const warnings: string[] = [];
    if (
      (orderInfo.ebayOrderId || orderInfo.ebayOrderUrl) &&
      combinedItems.length === 0 &&
      listingUrls.length === 0
    ) {
      warnings.push(
        `Pedido #${orderInfo.ebayOrderId || ''} vinculado! Como o link order.ebay.com é privado da sua conta, cole também o link do anúncio (ebay.com/itm/...) ou copie o texto da descrição/pedido aqui para preencher os CDs.`
      );
    } else if (listingUrls.length > 0 && combinedItems.length === 0) {
      warnings.push(
        'O eBay protegeu este link contra leitura automática. Copie e cole o texto da página do anúncio (incluindo a descrição com os álbuns) diretamente neste campo!'
      );
    }

    const responsePayload: EbayImportResult = {
      ebayOrderId: orderInfo.ebayOrderId || textParsed.ebayOrderId,
      ebayOrderUrl: orderInfo.ebayOrderUrl || textParsed.ebayOrderUrl,
      currency: detectedCurrency,
      internalShipping: detectedShipping,
      localTrackingCode: textParsed.localTrackingCode,
      bundleTotalValue: detectedBundleTotal,
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
