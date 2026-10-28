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
  bundleTotalValue?: number;
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
          ebayOrderUrl: `https://order.ebay.com/ord/show?orderId=${orderIdParam.trim()}`,
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
 * Também aceita URLs sem protocolo como "ebay.com/itm/840062942035"
 */
export function extractEbayListingUrls(input: string): string[] {
  if (!input) return [];

  // Adiciona https:// caso o usuário tenha colado direto da barra de endereços sem https:// (ex: "ebay.com/itm/840062942035")
  const normalizedInput = input.replace(
    /(^|\s)((?:www\.|m\.)?ebay\.[a-z.]+\/itm\/[^\s"'<>]+)/gi,
    '$1https://$2'
  );

  const matches = normalizedInput.match(
    /https?:\/\/(?:www\.|m\.)?(?:ebay\.[a-z.]+|ebay\.us)\/[^\s"'<>]+/gi
  );
  if (!matches) return [];

  const urls: string[] = [];
  const seen = new Set<string>();

  for (const raw of matches) {
    if (/\/ord\//i.test(raw)) continue;

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
 * Extrai IDs numéricos de anúncios do eBay (10 a 14 dígitos) de URLs /itm/ ou textos "Item number: 840062942035"
 */
export function extractEbayItemIds(input: string): string[] {
  if (!input) return [];
  const ids = new Set<string>();

  const urlMatches = input.matchAll(/\/itm\/(?:[^/?#\s]+\/)?(\d{10,14})\b/gi);
  for (const m of urlMatches) {
    ids.add(m[1]);
  }

  const labelMatches = input.matchAll(
    /(?:item\s*(?:id|number|no\.?|#)|n[úu]mero\s*do\s*item)\s*[:#-]?\s*(\d{10,14})\b/gi
  );
  for (const m of labelMatches) {
    ids.add(m[1]);
  }

  return Array.from(ids);
}

/**
 * Detecta se o título é de um Lote / Bundle e quantos CDs ele menciona (ex: "HIM CD/DVD ALBUM 6 BUNDLE" -> 6)
 */
export function detectBundleCountFromText(text: string): number | null {
  if (!text) return null;

  // Ex: "7 album cd bundle", "6 bundle", "bundle of 5 cds", "lot of 4 cds", "job lot 8 cds"
  const m1 = text.match(
    /\b(\d{1,2})\s*(?:x\s*)?(?:cd\/dvd\s*)?(?:albums?\s*)?(?:cds?\s*)?(?:bundle|lot|job\s*lot|lote)\b/i
  );
  if (m1) {
    const n = parseInt(m1[1], 10);
    if (n >= 2 && n <= 40) return n;
  }

  const m2 = text.match(
    /\b(?:bundle|lot|job\s*lot|lote)\s*(?:of|de|with|com)?\s*(\d{1,2})\s*(?:x\s*)?(?:cds?|albums?)\b/i
  );
  if (m2) {
    const n = parseInt(m2[1], 10);
    if (n >= 2 && n <= 40) return n;
  }

  const m3 = text.match(
    /\b(\d{1,2})\s*(?:x\s*)?(?:cd\s+albums|albums\s+cd\s+bundle)\b/i
  );
  if (m3) {
    const n = parseInt(m3[1], 10);
    if (n >= 2 && n <= 40) return n;
  }

  return null;
}

/**
 * Detecta quantidade de discos físicos de UM álbum (2CD, Double CD, + Bonus DVD, 3CD, Box Set)
 */
export function detectDiscCountFromTitle(rawTitle: string): number {
  const t = rawTitle.toLowerCase();

  // Se for título de bundle ("6 bundle", "7 album cd bundle"), não confunde com Box Set de 1 álbum
  if (/\b(?:bundle|job\s*lot|lote)\b/i.test(t)) {
    return 1;
  }

  // Ex: "(with bonus dvd)" ou "cd + dvd" ou "cd/dvd"
  if (/\b(?:with\s+bonus\s+dvd|cd\s*\+\s*dvd|cd\s*&\s*dvd)\b/i.test(t)) {
    return 2;
  }

  const explicitMulti = t.match(
    /\b([2-9]|1\d)\s*(?:x\s*)?(?:cd|cds|disc|discs)\b/i
  );
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

const KNOWN_UPPERCASE_BANDS = new Set([
  'HIM',
  'AFI',
  'AC/DC',
  'INXS',
  'MGMT',
  'NOFX',
  'POD',
  'P.O.D.',
  'REM',
  'R.E.M.',
  'U2',
  'CKY',
  'OMD',
  'KMFDM',
  'WASP',
  'W.A.S.P.',
]);

export function stripEbayArtifacts(str: string): string {
  if (!str) return '';
  return str
    .replace(/\b(?:ebay|www\.ebay\.[a-z.]+)\b/gi, ' ')
    .replace(/^ebay\s*/i, '')
    .replace(/\s*\|\s*ebay.*$/i, '')
    .replace(/^[\s\-–—:|•,/.]+|[\s\-–—:|•,/.]+$/g, '')
    .trim();
}

function normalizeCase(str: string): string {
  if (!str) return str;
  let trimmed = stripEbayArtifacts(str);

  if (KNOWN_UPPERCASE_BANDS.has(trimmed.toUpperCase())) {
    return trimmed.toUpperCase();
  }
  const letters = trimmed.replace(/[^a-zA-Z]/g, '');
  if (letters.length > 3 && trimmed === trimmed.toUpperCase()) {
    return trimmed
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return trimmed;
}

/**
 * Extrai o nome do Artista de um título de Bundle (ex: "HIM CD/DVD ALBUM 6 BUNDLE VV CD BUNDLE" -> "HIM")
 */
export function extractArtistFromBundleTitle(rawTitle: string): string {
  if (!rawTitle) return '';

  const cleanRaw = stripEbayArtifacts(rawTitle);

  // Se houver separador explícito antes da parte de bundle
  const beforeKeywords = cleanRaw.match(
    /^([A-Za-z0-9&'.\s]{2,40}?)\s+(?:[-–—:]\s*)?(?:cd\/dvd|cd\s+bundle|cd\s+lot|album|albums|\d+\s*(?:x\s*)?(?:cd|album|bundle|lot)|bundle|job\s*lot|discography|collection)\b/i
  );
  if (beforeKeywords && beforeKeywords[1]) {
    const candidate = stripEbayArtifacts(
      beforeKeywords[1].replace(
        /\b(?:cd|dvd|vg\+?|vv|mint|rare|uk|bundle|album|albums)\b/gi,
        ''
      )
    );
    if (candidate.length >= 2) {
      return normalizeCase(candidate);
    }
  }

  return '';
}

/**
 * Limpa termos comuns de anúncios de CDs no eBay e separa em Artista e Álbum
 */
export function parseEbayListingTitle(
  rawTitle: string,
  fallbackArtist?: string
): {
  artist: string;
  albumTitle: string;
  discCount: number;
  releaseYear?: string;
  isBundleTitle?: boolean;
  bundleCount?: number;
} {
  const bundleCount = detectBundleCountFromText(rawTitle);
  const isBundleTitle =
    bundleCount !== null || /\b(?:bundle|job\s*lot|lote)\b/i.test(rawTitle);

  if (isBundleTitle) {
    const bundleArtist =
      fallbackArtist || extractArtistFromBundleTitle(rawTitle);
    return {
      artist: bundleArtist,
      albumTitle: '',
      discCount: 1,
      isBundleTitle: true,
      bundleCount: bundleCount || undefined,
    };
  }

  const discCount = detectDiscCountFromTitle(rawTitle);
  const yearMatch = rawTitle.match(/\b(19[6-9]\d|20[0-2]\d)\b/);
  const releaseYear = yearMatch ? yearMatch[1] : undefined;

  let cleaned = stripEbayArtifacts(rawTitle)
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/^details\s+about\s+/i, '')
    // Remove numeração de lista no início (ex: "1 . Love Metal." -> "Love Metal")
    .replace(/^\s*\d{1,2}\s*[.)\-:]\s*/, '')
    // Remove tags de promo do vendedor britânico ("The Cheap Fast Free Post", "Fast & Free Post")
    .replace(
      /\b(?:the\s+cheap\s+fast\s+free\s+post|fast\s*(?:&|and)?\s*free\s*post|free\s*post|free\s*uk\s*delivery)\b/gi,
      ' '
    )
    // Remove termos de mídia comuns no final
    .replace(
      /\b(?:standard\s*jewel\s*case|jewel\s*case|digipak|digipack|sony\s*bmg|rca\s*rock|rca|sire\s*records|bmg)\b/gi,
      ' '
    )
    // Remove "(with bonus dvd)" ou similares após já termos detectado discCount
    .replace(/\(\s*with\s*bonus[^)]*\)/gi, ' ')
    .replace(/\(\s*witth\s*bonus[^)]*\)/gi, ' ')
    .replace(
      /[\[(]\s*(?:cd|audio\s*cd|2\s*cd|double\s*cd|3\s*cd|deluxe[^)\]]*|remaster[^)\]]*|digipak|digipack|jewel\s*case|uk\s*import|japan\s*import|new|sealed|vg\+|very\s*good|mint|nm|ex|\d{4})\s*[\])]/gi,
      ' '
    )
    .replace(
      /\b(?:audio\s*cd|music\s*cd|compact\s*disc|cd\s*album|album\s*cd|rock\s*cd|cd\/dvd|[2-9]\s*x?\s*cd\s*set|double\s*cd|triple\s*cd|deluxe\s*edition|special\s*edition|limited\s*edition|expanded\s*edition|remastered|digipak|digipack|jewel\s*case|brand\s*new|new\s*&\s*sealed|factory\s*sealed|sealed|very\s*good\s*condition|good\s*condition|like\s*new|near\s*mint|mint\s*condition|vg\+|vv|nm|fast\s*(?:&|and)?\s*free\s*(?:post|shipping|p&p|delivery)|free\s*(?:uk\s*)?(?:tracked\s*)?(?:postage|post|shipping|p&p|delivery)|uk\s*seller|official\s*release|import|obi\s*strip|w\/\s*obi)\b/gi,
      ' '
    )
    .replace(/(?:^|\s+)[-:•|]?\s*\bcds?\b\s*[-:•|]?(?:\s+|$)/gi, ' ')
    .replace(/\b(19[6-9]\d|20[0-2]\d)\b\s*$/g, ' ')
    .replace(/\(\s*\)|\[\s*\]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–—:|•,/.]+|[\s\-–—:|•,/.]+$/g, '')
    .trim();

  if (!cleaned) {
    cleaned = rawTitle.trim();
  }

  const separatorMatch = cleaned.match(
    /^(.+?)\s+(?:[-–—:/|]|\bby\b)\s+(.+)$/i
  );

  let artist = fallbackArtist || '';
  let albumTitle = '';

  if (separatorMatch) {
    if (/\s+by\s+/i.test(cleaned) && !cleaned.includes(' - ')) {
      albumTitle = separatorMatch[1].trim();
      artist = separatorMatch[2].trim();
    } else {
      artist = separatorMatch[1].trim();
      albumTitle = separatorMatch[2].trim();
    }
  } else if (!artist) {
    // Tenta reconhecer bandas populares no início do título (ex: "System of a Down Hypnotize 2005", "HIM Greatest Lovesongs...")
    const commonPrefixBands = [
      'System of a Down',
      'System Of A Down',
      'HIM',
      'Trivium',
      'Linkin Park',
      'Iron Maiden',
      'Metallica',
      'Slipknot',
      'Avenged Sevenfold',
      'Nightwish',
      'Evanescence',
      'Deftones',
      'Korn',
      'Rammstein',
      'Green Day',
      'Blink-182',
    ];
    for (const b of commonPrefixBands) {
      if (cleaned.toLowerCase().startsWith(b.toLowerCase())) {
        artist = b;
        albumTitle = cleaned.slice(b.length).trim();
        break;
      }
    }
    if (!albumTitle) {
      albumTitle = cleaned;
    }
  } else {
    albumTitle = cleaned;
  }

  artist = stripEbayArtifacts(artist);
  albumTitle = stripEbayArtifacts(albumTitle)
    // Remove palavras soltas residuais de gênero ou mídias no final
    .replace(/\b(?:cd\s*album|album|rock|metal)\b\s*$/gi, '')
    .replace(/\(\s*\)|\[\s*\]/g, ' ')
    .replace(/^[\s\-–—:|•,.]+|[\s\-–—:|•,.]+$/g, '')
    .trim();

  // Correções ortográficas comuns de vendedores em álbuns famosos (ex: "Raserblade Romance" -> "Razorblade Romance")
  if (/^raserblade\s+romance$/i.test(albumTitle)) {
    albumTitle = 'Razorblade Romance';
  }

  return {
    artist: normalizeCase(artist),
    albumTitle: normalizeCase(albumTitle || cleaned),
    discCount,
    releaseYear,
  };
}

/**
 * Extrai uma lista numerada ou com marcadores de álbuns dentro da descrição do vendedor
 * Ex:
 * 1 . Love Metal.
 * 2. Dark Light.
 * 3. Venus Doom.
 */
export function extractNumberedAlbumsFromDescription(
  descriptionText: string,
  defaultArtist: string = ''
): ParsedEbayCDItem[] {
  if (!descriptionText) return [];

  const lines = descriptionText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const numberedItems: ParsedEbayCDItem[] = [];

  for (const line of lines) {
    // Casa linhas como "1 . Love Metal.", "2. Dark Light.", "1) Album", "- Album"
    const match = line.match(/^\s*(\d{1,2})\s*[.)\-:]\s*(.{2,100})$/);
    if (match) {
      const rawAlbumLine = match[2].trim();

      // Ignora hashes técnicos ou IDs hexadecimais (ex: a8c1ce17.1793160199.bb2e65d ou 0.5d84917...)
      if (
        /^[a-f0-9]{4,}\.[a-f0-9]{4,}/i.test(rawAlbumLine) ||
        /\b[a-f0-9]{8,}\.[a-f0-9]{6,}/i.test(rawAlbumLine) ||
        /^[a-z0-9._\-]{12,}$/i.test(rawAlbumLine) ||
        /\b(?:reference\s*id|something\s*went\s*wrong|rlogid|sessionid)\b/i.test(
          rawAlbumLine
        )
      ) {
        continue;
      }

      // Evita linhas que sejam políticas do vendedor
      if (
        /\b(?:days?\s+returns?|buyer\s+pays|free\s+uk|postage|condition|offers?\s+considered|discs?\s+and\s+covers?|tracked\s+post|business\s+information|all\s+rights\s+reserved)\b/i.test(
          rawAlbumLine
        )
      ) {
        continue;
      }

      // Uma linha de título real precisa ter letras legíveis e não apenas códigos
      const letterCount = (rawAlbumLine.match(/[a-zA-Z]/g) || []).length;
      if (letterCount < 3) {
        continue;
      }

      const parsed = parseEbayListingTitle(rawAlbumLine, defaultArtist);
      if (parsed.albumTitle) {
        numberedItems.push({
          rawTitle: rawAlbumLine,
          artist: parsed.artist || defaultArtist,
          albumTitle: parsed.albumTitle,
          discCount: parsed.discCount,
          releaseYear: parsed.releaseYear,
        });
      }
    }
  }

  return numberedItems;
}

/**
 * Detecta a moeda e o valor numérico em uma string como "£12.99", "GBP 18.00", "US $9.99", "EUR 8,50"
 */
export function parsePriceAndCurrency(text: string): {
  amount?: number;
  currency?: CurrencyCode;
} {
  if (!text) return {};

  // Ignora valores aproximados secundários do eBay como "Approximately US $24.02"
  const cleanedText = text.replace(
    /approximately\s*(?:£|US\s*\$|\$|€|¥|R\$|\b(?:GBP|USD|EUR|JPY|BRL)\b)\s*\d+(?:[.,]\d{1,2})?/gi,
    ''
  );

  let currency: CurrencyCode | undefined;
  if (/£|\bGBP\b|\bRoyal\s*Mail\b|\bUK\s*Tracked\b|\bFree\s*UK\b/i.test(cleanedText))
    currency = 'GBP';
  else if (/€|\bEUR\b/i.test(cleanedText)) currency = 'EUR';
  else if (/¥|\bJPY\b/i.test(cleanedText)) currency = 'JPY';
  else if (/R\$|\bBRL\b/i.test(cleanedText)) currency = 'BRL';
  else if (/\$|\bUSD\b/i.test(cleanedText)) currency = 'USD';
  else if (/R\$|\bBRL\b/i.test(cleanedText)) currency = 'BRL';
  else if (/\$|\bUSD\b/i.test(cleanedText)) currency = 'USD';

  const priceMatch = cleanedText.match(
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
 * Valida se um código de rastreio extraído parece realmente um código postal (contém números e letras, e não palavras comuns como AVAILABLE)
 */
export function isValidTrackingCodeCandidate(candidate: string): boolean {
  if (!candidate) return false;
  const upper = candidate.trim().toUpperCase();
  if (upper.length < 8 || upper.length > 26) return false;

  const bannedWords = new Set([
    'AVAILABLE',
    'PROVIDED',
    'UPLOADED',
    'INFORMATION',
    'DETAILS',
    'TRACKING',
    'DELIVERED',
    'DISPATCHED',
    'SHIPPING',
    'UNAVAILABLE',
    'NUMBER',
  ]);
  if (bannedWords.has(upper)) return false;

  // Todo código de rastreio real possui pelo menos 3 dígitos numéricos
  const digitCount = (upper.match(/\d/g) || []).length;
  return digitCount >= 3;
}

/**
 * Faz o parse de texto copiado direto da página de detalhes do pedido do eBay (order.ebay.com)
 * OU da página do anúncio (ebay.com/itm/...)
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
  let specificArtist = '';

  // Detecta moeda inicial com base no texto geral
  if (/£|\bGBP\b|\bRoyal\s*Mail\b|\bUK\s*Tracked\b|\bFree\s*UK\b/i.test(rawText)) {
    detectedCurrency = 'GBP';
  } else if (/€|\bEUR\b/i.test(rawText)) {
    detectedCurrency = 'EUR';
  } else if (/¥|\bJPY\b/i.test(rawText)) {
    detectedCurrency = 'JPY';
  } else if (/R\$|\bBRL\b/i.test(rawText)) {
    detectedCurrency = 'BRL';
  } else if (/\$|\bUSD\b/i.test(rawText)) {
    detectedCurrency = 'USD';
  }

  // 0. Tenta extrair "Artist: HIM" dos Item Specifics se o usuário copiou a página do anúncio
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m1 = line.match(
      /^(?:artist|artista)\s*[:\t\s]\s*([A-Za-z0-9&'.\s]{2,40})$/i
    );
    if (m1) {
      specificArtist = normalizeCase(m1[1]);
      break;
    }
    const m2 = line.match(
      /\b(?:artist|artista)\s*[:\t]?\s*([A-Za-z0-9&'.\s]{2,30}?)(?:\s+(?:type|title|condition|genre|format|label|language|case|country|release)|\s*$)/i
    );
    if (m2) {
      specificArtist = normalizeCase(m2[1]);
      break;
    }
    if (/^(?:artist|artista)$/i.test(line) && lines[i + 1]) {
      specificArtist = normalizeCase(lines[i + 1]);
      break;
    }
  }

  // 1. Detecta código de rastreio real (precisa ter dígitos!)
  const trackingMatches = rawText.matchAll(
    /(?:tracking\s*(?:number|no\.?|#)?|rastreamento|rastreio)\s*[:#-]?\s*([A-Z0-9]{8,26})\b/gi
  );
  for (const m of trackingMatches) {
    if (isValidTrackingCodeCandidate(m[1])) {
      localTrackingCode = m[1].toUpperCase();
      break;
    }
  }

  // 2. Detecta frete ("Shipping: Free", "Free UK Tracked Post", "Postage: GBP 3.50", etc.)
  if (
    /\bfree\s+(?:royal\s+mail|uk\s+tracked|postage|shipping|delivery|p&p)\b/i.test(
      rawText
    ) ||
    /(?:shipping|delivery|postage|p&p|frete)\s*[:\t]?\s*free\b/i.test(rawText)
  ) {
    internalShipping = 0;
  } else {
    const shippingMatch = rawText.match(
      /(?:shipping|delivery|postage|p&p|frete|envio)\s*[:\t]?\s*(?:£|US\s*\$|\$|€|¥|R\$|\b(?:GBP|USD|EUR)\b)\s*(\d+(?:[.,]\d{1,2})?)/i
    );
    if (shippingMatch && shippingMatch[1]) {
      internalShipping = parseFloat(shippingMatch[1].replace(',', '.'));
    }
  }

  // 3. Detecta o preço principal no texto (ex: "GBP 18.00", "GBP 18.00Unit price", "£18.00")
  let mainDetectedPrice: number | undefined;
  for (const line of lines) {
    if (/approximately/i.test(line)) continue;
    const pInfo = parsePriceAndCurrency(line);
    if (pInfo.amount !== undefined) {
      // Valida se a linha parece de preço (não é número de item)
      if (
        /(?:unit\s*price|or\s*best\s*offer|item\s*price|price|bid|total|subtotal|sold\s*for|winning\s*bid)/i.test(
          line
        ) ||
        /^[\s£$€A-Z0-9.,]+$/i.test(line)
      ) {
        if (mainDetectedPrice === undefined) {
          mainDetectedPrice = pInfo.amount;
        }
        if (pInfo.currency) {
          detectedCurrency = pInfo.currency;
        }
      }
    }
  }

  // 4. Verifica se o texto contém uma lista numerada de álbuns (como na descrição de um bundle: "1. Love Metal", "2. Dark Light"...)
  // Procura também um artista mencionado antes da lista (ex: "HIM 7 album cd bundle.")
  if (!specificArtist) {
    for (const line of lines) {
      const bundleHeaderArtist = extractArtistFromBundleTitle(line);
      if (bundleHeaderArtist) {
        specificArtist = bundleHeaderArtist;
        break;
      }
    }
  }

  const numberedAlbums = extractNumberedAlbumsFromDescription(
    rawText,
    specificArtist
  );
  if (numberedAlbums.length >= 2) {
    const unitPriceEach =
      mainDetectedPrice !== undefined
        ? Number((mainDetectedPrice / numberedAlbums.length).toFixed(4))
        : undefined;

    return {
      ebayOrderId,
      ebayOrderUrl,
      currency: detectedCurrency,
      internalShipping,
      localTrackingCode,
      bundleTotalValue: mainDetectedPrice,
      items: numberedAlbums.map((item) => ({
        ...item,
        unitPrice: unitPriceEach,
        currency: detectedCurrency,
      })),
    };
  }

  // 5. Procura itens de CD no texto do pedido (order.ebay.com)
  const items: ParsedEbayCDItem[] = [];
  const seenNormalizedTitles = new Set<string>();

  const ignoredLinePattern =
    /^(?:order\s*total|subtotal|item\s*\(\d+\)|items\s*\(\d+\)|shipping|delivery|postage|tax|vat|total|estimated\s*delivery|order\s*number|order\s*id|seller|payment|returns|view\s*order|track\s*package|buy\s*it\s*again|contact\s*seller|leave\s*feedback|more\s*actions|see\s*details|you\s*bought\s*this\s*item|condition|ended|located\s*in|cancellations|shop\s*with\s*confidence|item\s*description|seller\s*business|have\s*one\s*to\s*sell|sell\s*one\s*like\s*this|approximately|quantity|unit\s*price)/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Ignora linhas que são puramente preço ("GBP 18.00Unit price", "GBP 18.00", "Approximately US $24.02")
    if (
      ignoredLinePattern.test(line) ||
      /unit\s*price/i.test(line) ||
      /best\s*offer/i.test(line) ||
      /^\d+\s*bids?\b/i.test(line) ||
      /^(?:£|US\s*\$|\$|€|R\$|\b(?:GBP|USD|EUR)\b)\s*\d+(?:[.,]\d{1,2})?/i.test(
        line
      )
    ) {
      const p = parsePriceAndCurrency(line);
      if (p.currency && !detectedCurrency) detectedCurrency = p.currency;
      continue;
    }

    const isLikelyTitle =
      line.length >= 8 &&
      line.length <= 160 &&
      !line.startsWith('http') &&
      (/\bcd\b|\bdvd\b|album|bundle|edition|disc|box\s*set/i.test(line) ||
        /\s+[-–—]\s+/.test(line));

    if (!isLikelyTitle) continue;

    const normKey = line.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (seenNormalizedTitles.has(normKey)) {
      continue; // Evita duplicar quando o eBay repete o título na imagem e no link
    }
    seenNormalizedTitles.add(normKey);

    // Olha nas próximas 1 a 6 linhas pelo preço deste item (incluindo "GBP 18.00Unit price")
    let foundPrice: number | undefined;
    let foundQty = 1;
    for (let j = i + 1; j <= Math.min(lines.length - 1, i + 6); j++) {
      const nextLine = lines[j];
      const qtyMatch = nextLine.match(
        /(?:quantity|qty|quantidade)\s*[:#]?\s*(\d+)/i
      );
      if (qtyMatch) {
        foundQty = Math.max(1, parseInt(qtyMatch[1], 10) || 1);
      }

      if (/approximately/i.test(nextLine)) continue;

      if (
        /^(?:£|US\s*\$|\$|€|R\$|\b(?:GBP|USD|EUR)\b)\s*\d+(?:[.,]\d{1,2})?(?:\s*unit\s*price|\s*or\s*best\s*offer)?$/i.test(
          nextLine
        ) ||
        /(?:item\s*price|unit\s*price|price)\s*[:#]?\s*(?:£|US\s*\$|\$|€|\b(?:GBP|USD|EUR)\b)/i.test(
          nextLine
        )
      ) {
        const p = parsePriceAndCurrency(nextLine);
        if (p.amount !== undefined) {
          foundPrice = p.amount;
          if (p.currency && !detectedCurrency) detectedCurrency = p.currency;
          break;
        }
      }
    }

    const effectivePrice = foundPrice ?? mainDetectedPrice;
    const parsedTitle = parseEbayListingTitle(line, specificArtist);

    // Se o título no pedido for um Bundle (ex: "HIM CD/DVD ALBUM 6 BUNDLE VV CD BUNDLE")
    if (parsedTitle.isBundleTitle) {
      const count = parsedTitle.bundleCount || 2;
      const artistName = parsedTitle.artist || specificArtist || '';
      const unitBundlePrice =
        effectivePrice !== undefined
          ? Number((effectivePrice / count).toFixed(4))
          : undefined;

      for (let k = 0; k < count; k++) {
        items.push({
          rawTitle: line,
          artist: artistName,
          albumTitle: `CD #${k + 1} do Lote${artistName ? ` (${artistName})` : ''}`,
          discCount: 1,
          unitPrice: unitBundlePrice,
          currency: detectedCurrency,
        });
      }
    } else {
      items.push({
        rawTitle: line,
        artist: parsedTitle.artist,
        albumTitle: parsedTitle.albumTitle,
        discCount: parsedTitle.discCount,
        releaseYear: parsedTitle.releaseYear,
        unitPrice: effectivePrice,
        quantity: foundQty,
        currency: detectedCurrency,
      });
    }
  }

  return {
    ebayOrderId,
    ebayOrderUrl,
    currency: detectedCurrency,
    internalShipping,
    localTrackingCode,
    bundleTotalValue: mainDetectedPrice,
    items,
  };
}
