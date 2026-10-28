import { CurrencyCode } from '@/types/tracker';

export interface ParsedEbayCDItem {
  rawTitle: string;
  artist: string;
  albumTitle: string;
  discCount: number;
  unitPrice?: number;
  quantity?: number;
  currency?: CurrencyCode;
  shippingPrice?: number;
  releaseYear?: string;
  coverUrl?: string;
  ebayListingUrl?: string;
}

export interface EbayImportResult {
  ebayOrderId?: string;
  ebayOrderUrl?: string;
  currency?: CurrencyCode;
  internalShipping?: number;
  localTrackingCode?: string;
  shippingDate?: string;
  items: ParsedEbayCDItem[];
  warnings?: string[];
}

const ORDER_ID_REGEX = /\b(\d{2}-\d{5}-\d{5})\b/;

/**
 * Extrai o Order ID (ex: 04-15363-94135) e monta a URL limpa do pedido no eBay
 */
export function extractEbayOrderInfo(input: string): {
  ebayOrderId?: string;
  ebayOrderUrl?: string;
} {
  if (!input || !input.trim()) return {};
  const trimmed = input.trim();

  // 1. Tenta extrair de uma URL de pedido (ex: https://order.ebay.com/ord/show?orderId=04-15363-94135&purchaseOrderId=...#/)
  const urlMatch = trimmed.match(
    /https?:\/\/(?:order|www)\.ebay\.[a-z.]+\/ord\/[^\s"<>]+/i
  );
  if (urlMatch) {
    const cleanUrl = urlMatch[0].replace(/#\/?$/, '');
    try {
      const parsedUrl = new URL(cleanUrl);
      const orderIdParam = parsedUrl.searchParams.get('orderId');
      if (orderIdParam) {
        return {
          ebayOrderId: orderIdParam.trim(),
          ebayOrderUrl: cleanUrl,
        };
      }
    } catch {
      // Continua para regex
    }
    const idFromUrl = cleanUrl.match(ORDER_ID_REGEX);
    return {
      ebayOrderId: idFromUrl ? idFromUrl[1] : undefined,
      ebayOrderUrl: cleanUrl,
    };
  }

  // 2. Tenta extrair o padrão XX-XXXXX-XXXXX do texto
  const idMatch = trimmed.match(ORDER_ID_REGEX);
  if (idMatch) {
    const orderId = idMatch[1];
    return {
      ebayOrderId: orderId,
      ebayOrderUrl: `https://order.ebay.com/ord/show?orderId=${orderId}`,
    };
  }

  return {};
}

/**
 * Extrai URLs públicas de anúncios do eBay (/itm/... ou ebay.us/...)
 */
export function extractEbayListingUrls(input: string): string[] {
  if (!input) return [];
  const matches = input.match(
    /https?:\/\/(?:www\.|m\.)?(?:ebay\.[a-z.]+|ebay\.us)\/[^\s"'<>]+/gi
  );
  if (!matches) return [];

  const urls: string[] = [];
  const seen = new Set<string>();

  for (const raw of matches) {
    // Ignora links de pedido (order.ebay.com/ord/...)
    if (/\/ord\//i.test(raw)) continue;

    // Se for link /itm/, limpa parâmetros de tracking desnecessários
    const itmMatch = raw.match(
      /^(https?:\/\/(?:www\.|m\.)?ebay\.[a-z.]+\/itm\/(?:[^/?#\s]+\/)?\d+)/i
    );
    const normalized = itmMatch
      ? itmMatch[1].replace('://m.ebay.', '://www.ebay.')
      : raw.replace(/[),.;]+$/, '');

    if (!seen.has(normalized)) {
      seen.add(normalized);
      urls.push(normalized);
    }
  }

  return urls;
}

/**
 * Detecta quantidade de discos (2CD, Double CD, 3CD, Box Set) no título do anúncio
 */
export function detectDiscCountFromTitle(rawTitle: string): number {
  const t = rawTitle.toLowerCase();

  const explicitMulti = t.match(/\b([2-9]|1\d)\s*(?:x\s*)?(?:cd|cds|disc|discs)\b/i);
  if (explicitMulti) {
    const count = parseInt(explicitMulti[1], 10);
    if (count >= 2 && count <= 20) return count;
  }

  if (/\b(?:double\s+cd|2cd|2xcd|two\s+cd|duplo)\b/i.test(t)) return 2;
  if (/\b(?:triple\s+cd|3cd|3xcd|three\s+cd|triplo)\b/i.test(t)) return 3;
  if (/\b(?:quad\s+cd|4cd|4xcd)\b/i.test(t)) return 4;
  if (/\bbox\s*set\b/i.test(t)) return 3;

  return 1;
}

/**
 * Limpa termos comuns de anúncios de CDs no eBay e separa em Artista e Álbum
 */
export function parseEbayListingTitle(rawTitle: string): {
  artist: string;
  albumTitle: string;
  discCount: number;
  releaseYear?: string;
} {
  const discCount = detectDiscCountFromTitle(rawTitle);

  // Tenta extrair ano de lançamento (1960 - 2029)
  const yearMatch = rawTitle.match(/\b(19[6-9]\d|20[0-2]\d)\b/);
  const releaseYear = yearMatch ? yearMatch[1] : undefined;

  let cleaned = rawTitle
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    // Remove prefixos do eBay como "Details about ..."
    .replace(/^details\s+about\s+/i, '')
    // Remove colchetes/parênteses puramente descritivos de mídia/estado
    .replace(
      /[\[(]\s*(?:cd|audio\s*cd|2\s*cd|double\s*cd|3\s*cd|deluxe[^)\]]*|remaster[^)\]]*|digipak|digipack|jewel\s*case|uk\s*import|japan\s*import|new|sealed|vg\+|very\s*good|mint|nm|ex|\d{4})\s*[\])]/gi,
      ' '
    )
    // Remove termos de condição/envio comuns no final de títulos do eBay
    .replace(
      /\b(?:audio\s*cd|music\s*cd|compact\s*disc|cd\s*album|album\s*cd|[2-9]\s*x?\s*cd\s*set|double\s*cd|triple\s*cd|deluxe\s*edition|special\s*edition|limited\s*edition|expanded\s*edition|remastered|digipak|digipack|jewel\s*case|brand\s*new|new\s*&\s*sealed|factory\s*sealed|sealed|very\s*good\s*condition|good\s*condition|like\s*new|near\s*mint|mint\s*condition|vg\+|nm|fast\s*(?:&|and)?\s*free\s*(?:post|shipping|p&p|delivery)|free\s*(?:uk\s*)?(?:postage|shipping|p&p|delivery)|uk\s*seller|official\s*release|import|obi\s*strip|w\/\s*obi)\b/gi,
      ' '
    )
    // Remove palavra "CD" solta no final ou cercada de pontuação
    .replace(/(?:^|\s+)[-:•|]?\s*\bcds?\b\s*[-:•|]?(?:\s+|$)/gi, ' ')
    // Remove anos soltos no final se já capturados
    .replace(/\b(19[6-9]\d|20[0-2]\d)\b\s*$/g, ' ')
    // Limpa múltiplos espaços e traços duplicados nas pontas
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–—:|•,/]+|[\s\-–—:|•,/]+$/g, '')
    .trim();

  if (!cleaned) {
    cleaned = rawTitle.trim();
  }

  // Separa Artista e Álbum usando separadores: " - ", " – ", " — ", " : ", " / "
  const separatorMatch = cleaned.match(
    /^(.+?)\s+(?:[-–—:/|]|\bby\b)\s+(.+)$/i
  );

  let artist = '';
  let albumTitle = '';

  if (separatorMatch) {
    // Se usou "Album by Artist"
    if (/\s+by\s+/i.test(cleaned) && !cleaned.includes(' - ')) {
      albumTitle = separatorMatch[1].trim();
      artist = separatorMatch[2].trim();
    } else {
      artist = separatorMatch[1].trim();
      albumTitle = separatorMatch[2].trim();
    }
  } else {
    // Sem separador explícito: coloca na linha do álbum ou divide se houver maiúsculas claras
    artist = '';
    albumTitle = cleaned;
  }

  // Limpa restos de pontuação nas pontas de artist e albumTitle
  artist = artist.replace(/^[\s\-–—:|•,]+|[\s\-–—:|•,]+$/g, '').trim();
  albumTitle = albumTitle.replace(/^[\s\-–—:|•,]+|[\s\-–—:|•,]+$/g, '').trim();

  // Converte CAIXA ALTA exagerada (ex: "IRON MAIDEN") para Title Case legível
  const normalizeCase = (str: string) => {
    if (!str) return str;
    const letters = str.replace(/[^a-zA-Z]/g, '');
    if (letters.length > 3 && str === str.toUpperCase()) {
      return str
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return str;
  };

  return {
    artist: normalizeCase(artist),
    albumTitle: normalizeCase(albumTitle || cleaned),
    discCount,
    releaseYear,
  };
}

/**
 * Detecta a moeda e o valor numérico em uma string como "£12.99", "GBP 4.50", "US $9.99", "EUR 8,50"
 */
export function parsePriceAndCurrency(text: string): {
  amount?: number;
  currency?: CurrencyCode;
} {
  if (!text) return {};

  let currency: CurrencyCode | undefined;
  if (/£|\bGBP\b/i.test(text)) currency = 'GBP';
  else if (/€|\bEUR\b/i.test(text)) currency = 'EUR';
  else if (/¥|\bJPY\b/i.test(text)) currency = 'JPY';
  else if (/R\$|\bBRL\b/i.test(text)) currency = 'BRL';
  else if (/\$|\bUSD\b/i.test(text)) currency = 'USD';

  const priceMatch = text.match(
    /(?:£|US\s*\$|\$|€|¥|R\$|\b(?:GBP|USD|EUR|JPY|BRL)\b)\s*(\d{1,5}(?:[.,]\d{1,2})?)/i
  );

  if (priceMatch) {
    const normalizedNum = priceMatch[1].replace(',', '.');
    const val = parseFloat(normalizedNum);
    if (!Number.isNaN(val)) {
      return { amount: val, currency };
    }
  }

  return { currency };
}

/**
 * Faz o parse de texto copiado direto da página de detalhes do pedido do eBay (order.ebay.com)
 * ou e-mail de confirmação do pedido
 */
export function parseEbayOrderCopiedText(rawText: string): EbayImportResult {
  const { ebayOrderId, ebayOrderUrl } = extractEbayOrderInfo(rawText);

  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let detectedCurrency: CurrencyCode | undefined;
  let internalShipping: number | undefined;
  let localTrackingCode: string | undefined;

  // 1. Detecta código de rastreio se presente ("Tracking number", "Número de rastreamento")
  const trackingMatch = rawText.match(
    /(?:tracking\s*(?:number|no\.?|#)?|rastreamento|rastreio)\s*[:#-]?\s*([A-Z0-9]{8,26})/i
  );
  if (trackingMatch) {
    localTrackingCode = trackingMatch[1].toUpperCase();
  }

  // 2. Detecta frete ("Shipping", "Delivery", "Postage", "Frete", "Envio")
  const shippingMatch = rawText.match(
    /(?:shipping|delivery|postage|p&p|frete|envio)[^\n\d£$€¥]{0,25}(?:free|gr[aá]tis|(?:£|US\s*\$|\$|€|¥|R\$|\b(?:GBP|USD|EUR)\b)\s*(\d+(?:[.,]\d{1,2})?))/i
  );
  if (shippingMatch) {
    if (shippingMatch[1]) {
      internalShipping = parseFloat(shippingMatch[1].replace(',', '.'));
    } else if (/free|gr[aá]tis/i.test(shippingMatch[0])) {
      internalShipping = 0;
    }
  }

  // 3. Procura itens de CD no texto do pedido
  const items: ParsedEbayCDItem[] = [];
  const ignoredLabels =
    /^(?:order\s*total|subtotal|item\s*\(\d+\)|items\s*\(\d+\)|shipping|delivery|postage|tax|vat|total|estimated\s*delivery|order\s*number|order\s*id|seller|payment|returns|view\s*order|track\s*package|buy\s*it\s*again|contact\s*seller|leave\s*feedback|more\s*actions|see\s*details)/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (ignoredLabels.test(line)) {
      const p = parsePriceAndCurrency(line);
      if (p.currency && !detectedCurrency) detectedCurrency = p.currency;
      continue;
    }

    // Caso A: A própria linha tem um título razoável (> 8 chars) e um preço no final
    const inlinePriceMatch = line.match(
      /^(.{8,140}?)\s+(?:£|US\s*\$|\$|€|R\$|\b(?:GBP|USD|EUR)\b)\s*(\d+(?:[.,]\d{1,2})?)$/i
    );
    if (inlinePriceMatch && !ignoredLabels.test(inlinePriceMatch[1])) {
      const titleCandidate = inlinePriceMatch[1].trim();
      const priceInfo = parsePriceAndCurrency(line);
      if (priceInfo.currency && !detectedCurrency) {
        detectedCurrency = priceInfo.currency;
      }
      const parsedTitle = parseEbayListingTitle(titleCandidate);
      items.push({
        rawTitle: titleCandidate,
        artist: parsedTitle.artist,
        albumTitle: parsedTitle.albumTitle,
        discCount: parsedTitle.discCount,
        releaseYear: parsedTitle.releaseYear,
        unitPrice: priceInfo.amount,
        currency: priceInfo.currency || detectedCurrency,
      });
      continue;
    }

    // Caso B: No layout do order.ebay.com, o título do item vem numa linha e o preço logo nas próximas 1 a 4 linhas
    const isLikelyTitle =
      line.length >= 10 &&
      line.length <= 160 &&
      !line.startsWith('http') &&
      !ignoredLabels.test(line) &&
      (/[-–—]/.test(line) || /\bcd\b|album|edition|disc|vinyl|box/i.test(line));

    if (isLikelyTitle) {
      let foundPrice: number | undefined;
      let foundQty = 1;
      for (let j = i + 1; j <= Math.min(lines.length - 1, i + 5); j++) {
        const nextLine = lines[j];
        const qtyMatch = nextLine.match(
          /(?:quantity|qty|quantidade)\s*[:#]?\s*(\d+)/i
        );
        if (qtyMatch) {
          foundQty = Math.max(1, parseInt(qtyMatch[1], 10) || 1);
        }
        if (
          /^(?:£|US\s*\$|\$|€|R\$|\b(?:GBP|USD|EUR)\b)\s*\d+(?:[.,]\d{1,2})?$/i.test(
            nextLine
          ) ||
          /(?:item\s*price|price)\s*[:#]?\s*(?:£|US\s*\$|\$|€)/i.test(nextLine)
        ) {
          const p = parsePriceAndCurrency(nextLine);
          if (p.amount !== undefined) {
            foundPrice = p.amount;
            if (p.currency && !detectedCurrency) detectedCurrency = p.currency;
            i = j; // avança o ponteiro
            break;
          }
        }
      }

      if (foundPrice !== undefined || /\bcd\b/i.test(line)) {
        const parsedTitle = parseEbayListingTitle(line);
        items.push({
          rawTitle: line,
          artist: parsedTitle.artist,
          albumTitle: parsedTitle.albumTitle,
          discCount: parsedTitle.discCount,
          releaseYear: parsedTitle.releaseYear,
          unitPrice: foundPrice,
          quantity: foundQty,
          currency: detectedCurrency,
        });
      }
    }
  }

  return {
    ebayOrderId,
    ebayOrderUrl,
    currency: detectedCurrency,
    internalShipping,
    localTrackingCode,
    items,
  };
}
