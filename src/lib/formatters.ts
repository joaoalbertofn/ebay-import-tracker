import { CurrencyCode } from '@/types/tracker';

export function getTodayLocalIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

export function formatWeightKg(weightKg?: number): string {
  if (!weightKg || !Number.isFinite(weightKg) || weightKg <= 0) return '';
  return `${weightKg.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} kg`;
}

export function formatShortBundleBadge(
  item: { bundleTotalQuantity?: number; bundleName?: string },
  currentShipmentName: string
): string {
  const qty = item.bundleTotalQuantity || 1;
  const rawName = (item.bundleName || '').trim();
  if (
    !rawName ||
    rawName === currentShipmentName ||
    rawName.startsWith('[Lote]') ||
    rawName.startsWith('[CD Individual]') ||
    rawName.startsWith('[Vinil Individual]')
  ) {
    return `Lote (1/${qty})`;
  }
  const shortName =
    rawName.length > 18 ? `${rawName.slice(0, 18).trim()}…` : rawName;
  return `${shortName} (1/${qty})`;
}

export function formatMediaCountLabel(
  cdCount: number,
  vinylCount: number = 0
): string {
  if (vinylCount > 0 && cdCount > 0) {
    return `${cdCount} ${cdCount === 1 ? 'CD' : 'CDs'} + ${vinylCount} ${
      vinylCount === 1 ? 'Vinil' : 'Vinis'
    }`;
  }
  if (vinylCount > 0) {
    return `${vinylCount} ${vinylCount === 1 ? 'Vinil' : 'Vinis'}`;
  }
  return `${cdCount} ${cdCount === 1 ? 'CD' : 'CDs'}`;
}

export const CURRENCY_HUB_INFO: Record<
  CurrencyCode,
  { flag: string; shortHub: string; fullHub: string }
> = {
  GBP: { flag: '🇬🇧', shortHub: 'UK', fullHub: 'Hub UK (ForwardVia / Send2Hub)' },
  USD: { flag: '🇺🇸', shortHub: 'EUA', fullHub: 'Hub EUA (UsCloser - Orlando)' },
  EUR: { flag: '🇪🇺', shortHub: 'UE', fullHub: 'Hub Europa (Alemanha / UE)' },
  JPY: { flag: '🇯🇵', shortHub: 'JP', fullHub: 'Hub Japão' },
  BRL: { flag: '🇧🇷', shortHub: 'BR', fullHub: 'Nacional (Brasil)' },
};
