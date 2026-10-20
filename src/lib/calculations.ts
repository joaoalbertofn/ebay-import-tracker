import {
  CDItem,
  CalculatedCDItem,
  CurrencyCode,
  Shipment,
  ShipmentCalculationSummary,
} from '@/types/tracker';

export const MG_TAX_FACTOR = 0.9277;
export const DEFAULT_POSTAL_FEE_BRL = 0;

export const CURRENCY_META: Record<
  CurrencyCode,
  {
    symbol: string;
    label: string;
    defaultRate: number;
    defaultGroupOnlyFee: number;
    defaultUnpackAndRepackFee: number;
  }
> = {
  GBP: {
    symbol: '£',
    label: 'Libra Esterlina (GBP)',
    defaultRate: 7.45,
    defaultGroupOnlyFee: 3.0,
    defaultUnpackAndRepackFee: 6.5,
  },
  USD: {
    symbol: 'US$',
    label: 'Dólar Americano (USD)',
    defaultRate: 5.75,
    defaultGroupOnlyFee: 4.0,
    defaultUnpackAndRepackFee: 8.5,
  },
  EUR: {
    symbol: '€',
    label: 'Euro (EUR)',
    defaultRate: 6.25,
    defaultGroupOnlyFee: 3.5,
    defaultUnpackAndRepackFee: 7.5,
  },
  JPY: {
    symbol: '¥',
    label: 'Iene Japonês (JPY)',
    defaultRate: 0.038,
    defaultGroupOnlyFee: 500,
    defaultUnpackAndRepackFee: 1000,
  },
  BRL: {
    symbol: 'R$',
    label: 'Real Brasileiro (BRL)',
    defaultRate: 1.0,
    defaultGroupOnlyFee: 15.0,
    defaultUnpackAndRepackFee: 35.0,
  },
};

/**
 * Retorna o frete interno unitário (na moeda original) correspondente a 1 CD específico
 * quando o frete interno foi lançado no nível de CD/Bundle.
 * Se um lote (bundle) for desmembrado em pacotes diferentes, divide proporcionalmente por CD.
 */
export function getItemUnitInternalShipping(
  item: CDItem,
  allItems?: CDItem[]
): number {
  if (
    item.unitInternalShipping !== undefined &&
    Number.isFinite(Number(item.unitInternalShipping))
  ) {
    return Number(item.unitInternalShipping);
  }

  const rawBundleShipping = Number(item.bundleInternalShipping) || 0;
  if (rawBundleShipping <= 0) return 0;

  if (item.isBundle) {
    if (item.bundleTotalQuantity && item.bundleTotalQuantity > 0) {
      return rawBundleShipping / Number(item.bundleTotalQuantity);
    }
    if (item.bundleId && allItems) {
      const siblingsCount = allItems.filter(
        (cd) => cd.bundleId === item.bundleId
      ).length;
      if (siblingsCount > 0) {
        return rawBundleShipping / siblingsCount;
      }
    }
  }

  return rawBundleShipping;
}

/**
 * Calcula todos os custos de um Pacote e o rateio exato de cada CD pertencente a ele,
 * seguindo estritamente as Regras de Negócio 1, 2, 3 e 4 (sem taxa de correios avulsa, usando valor único de importação).
 */
export function calculateShipmentSummary(
  shipment: Shipment,
  allItems: CDItem[]
): ShipmentCalculationSummary {
  const shipmentItems = allItems.filter(
    (item) => item.shipmentId === shipment.id
  );
  const totalItemsCount = shipmentItems.length;
  const totalPhysicalDiscsCount = shipmentItems.reduce(
    (acc, item) => acc + (Number(item.discCount) || 1),
    0
  );

  const exchangeRate =
    Number(shipment.exchangeRate) ||
    CURRENCY_META[shipment.currency]?.defaultRate ||
    1;

  // Soma do valor original dos CDs
  const totalItemsOriginal = shipmentItems.reduce(
    (acc, item) => acc + (Number(item.unitOriginalValue) || 0),
    0
  );
  const totalItemsBrl = totalItemsOriginal * exchangeRate;

  // Soma dos fretes internos locais lançados nos CDs/lotes (diluídos por CD)
  const bundlesInternalShippingOriginal = Number(
    shipmentItems
      .reduce(
        (acc, item) => acc + getItemUnitInternalShipping(item, allItems),
        0
      )
      .toFixed(4)
  );

  const totalInternalShippingOriginal =
    (Number(shipment.internalShipping) || 0) + bundlesInternalShippingOriginal;

  const forwarderFee = Number(shipment.forwarderFee) || 0;
  const internationalShipping = Number(shipment.internationalShipping) || 0;

  // Regra 1: Calcular o Custo Indireto Total do Pacote
  // Soma-se: (Frete Interno + Taxa Redirecionador + Frete Internacional) * Taxa de Câmbio
  // + Taxa Única de Importação (BRL)
  const totalOriginIndirectOriginal =
    totalInternalShippingOriginal + forwarderFee + internationalShipping;
  const totalOriginIndirectBrl = totalOriginIndirectOriginal * exchangeRate;

  const customsTaxBrl = Number(shipment.customsTaxBrl) || 0;
  const postalFeeBrl = 0; // Desativado conforme preferência: usa apenas valor único em customsTaxBrl

  const totalIndirectCostBrl = totalOriginIndirectBrl + customsTaxBrl;

  // Regra 2: O Rateio Unitário
  // Dividir o "Custo Indireto Total (BRL)" pela quantidade total de CDs cadastrados no pacote
  const allocatedCostPerItemBrl =
    totalItemsCount > 0 ? totalIndirectCostBrl / totalItemsCount : 0;

  // Regra 3: Calcular o Custo Final de cada CD
  // Custo_Final_BRL = (Valor_Unitario_Original * Taxa de Câmbio) + Rateio por CD
  const calculatedItems: CalculatedCDItem[] = shipmentItems.map((item) => {
    const unitOriginal = Number(item.unitOriginalValue) || 0;
    const directCostBrl = unitOriginal * exchangeRate;
    const finalCostBrl = directCostBrl + allocatedCostPerItemBrl;
    const discCount = Math.max(1, Number(item.discCount) || 1);
    const unitInternalShippingOriginal = getItemUnitInternalShipping(
      item,
      allItems
    );

    return {
      ...item,
      directCostBrl,
      unitInternalShippingOriginal,
      allocatedIndirectCostBrl: allocatedCostPerItemBrl,
      finalCostBrl,
      costPerDiscBrl: finalCostBrl / discCount,
    };
  });

  // Regra 4: Estimativa de Impostos MG (Fator 0,9277 apenas sobre o valor dos produtos/CDs convertidos para BRL)
  const estimatedTaxMgBrl = totalItemsBrl * MG_TAX_FACTOR;

  const totalShipmentCostBrl = totalItemsBrl + totalIndirectCostBrl;

  return {
    shipment: {
      ...shipment,
      postalFeeBrl,
    },
    items: calculatedItems,
    totalItemsCount,
    totalPhysicalDiscsCount,
    totalItemsOriginal,
    totalItemsBrl,
    bundlesInternalShippingOriginal,
    totalInternalShippingOriginal,
    totalOriginIndirectOriginal,
    totalOriginIndirectBrl,
    totalIndirectCostBrl,
    allocatedCostPerItemBrl,
    totalShipmentCostBrl,
    estimatedTaxMgBrl,
  };
}

/**
 * Busca a cotação comercial atual da moeda para BRL usando AwesomeAPI (dados públicos em tempo real),
 * com fallback para Open Exchange Rates caso necessário.
 */
export async function fetchLiveExchangeRate(
  currency: CurrencyCode
): Promise<{ rate: number; source: string; timestamp: string }> {
  if (currency === 'BRL') {
    return {
      rate: 1.0,
      source: 'Moeda Nacional',
      timestamp: new Date().toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      }),
    };
  }

  try {
    const response = await fetch(
      `https://economia.awesomeapi.com.br/json/last/${currency}-BRL`,
      { cache: 'no-store' }
    );
    if (response.ok) {
      const data = await response.json();
      const pairKey = `${currency}BRL`;
      if (data[pairKey] && data[pairKey].bid) {
        return {
          rate: Number(parseFloat(data[pairKey].bid).toFixed(4)),
          source: 'AwesomeAPI (Comercial)',
          timestamp: new Date().toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
          }),
        };
      }
    }
  } catch {
    // Continua para o fallback
  }

  try {
    const fallbackRes = await fetch(
      `https://open.er-api.com/v6/latest/${currency}`,
      { cache: 'no-store' }
    );
    if (fallbackRes.ok) {
      const fallbackData = await fallbackRes.json();
      if (fallbackData?.rates?.BRL) {
        return {
          rate: Number(Number(fallbackData.rates.BRL).toFixed(4)),
          source: 'ExchangeRate-API',
          timestamp: new Date().toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
          }),
        };
      }
    }
  } catch {
    // Retorna padrão se offline
  }

  return {
    rate: CURRENCY_META[currency].defaultRate,
    source: 'Cotação Automática de Referência',
    timestamp: new Date().toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    }),
  };
}

export function formatBrl(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatOriginalCurrency(
  value: number,
  currency: CurrencyCode
): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency,
  }).format(Number.isFinite(value) ? value : 0);
}

/**
 * Gera automaticamente o Nome Identificador do Pacote a partir dos CDs pertencentes a ele:
 * - 1 CD: "[CD Individual] Artista - Álbum"
 * - 2+ CDs: "[Lote] Artista 1 - Artista 2 - Artista 3" (artistas únicos na ordem em que aparecem)
 */
export function generatePackageName(
  items: Array<{ artist?: string; albumTitle?: string }>,
  fallbackName?: string
): string {
  const validItems = items.filter(
    (i) => (i.artist || '').trim() !== '' || (i.albumTitle || '').trim() !== ''
  );

  if (validItems.length === 0) {
    if (items.length > 1) {
      return `[Lote] ${items.length} CDs`;
    }
    return fallbackName?.trim() || '[CD Individual] Novo CD';
  }

  if (items.length === 1 && validItems.length === 1) {
    const artist = (validItems[0].artist || '').trim();
    const album = (validItems[0].albumTitle || '').trim();
    const isGenericAlbum =
      !album || album === 'Álbum' || album.startsWith('CD #');

    if (artist && !isGenericAlbum) {
      return `[CD Individual] ${artist} - ${album}`;
    }
    if (artist) {
      return `[CD Individual] ${artist}`;
    }
    if (album) {
      return `[CD Individual] ${album}`;
    }
    return '[CD Individual] Novo CD';
  }

  // 2 ou mais CDs -> [Lote] Artista 1 - Artista 2 - Artista 3
  const uniqueArtists: string[] = [];
  const seenLower = new Set<string>();

  for (const item of validItems) {
    const artist = (item.artist || '').trim();
    if (!artist || artist.startsWith('[Lote]') || artist.startsWith('[CD Individual]')) {
      continue;
    }
    const key = artist.toLowerCase();
    if (!seenLower.has(key)) {
      seenLower.add(key);
      uniqueArtists.push(artist);
    }
  }

  if (uniqueArtists.length > 0) {
    return `[Lote] ${uniqueArtists.join(' - ')}`;
  }

  return `[Lote] ${items.length} CDs`;
}

