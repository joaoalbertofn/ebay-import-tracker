import { CURRENCY_META } from '@/lib/calculations';
import { CurrencyCode } from '@/types/tracker';

export interface LiveExchangeRateResult {
  rate: number;
  source: string;
  timestamp: string;
}

/**
 * Busca a cotação comercial atual da moeda para BRL usando AwesomeAPI (dados públicos em tempo real),
 * com fallback para Open Exchange Rates caso necessário.
 */
export async function fetchLiveExchangeRate(
  currency: CurrencyCode
): Promise<LiveExchangeRateResult> {
  const currentTimestamp = () =>
    new Date().toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });

  if (currency === 'BRL') {
    return {
      rate: 1.0,
      source: 'Moeda Nacional',
      timestamp: currentTimestamp(),
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
          timestamp: currentTimestamp(),
        };
      }
    }
  } catch {
    // Continua para o fallback se a AwesomeAPI falhar
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
          timestamp: currentTimestamp(),
        };
      }
    }
  } catch {
    // Retorna cotação padrão se offline
  }

  return {
    rate: CURRENCY_META[currency].defaultRate,
    source: 'Cotação Automática de Referência',
    timestamp: currentTimestamp(),
  };
}
