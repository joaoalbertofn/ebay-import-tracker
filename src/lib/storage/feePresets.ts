import { CurrencyCode } from '@/types/tracker';
import { CURRENCY_META } from '@/lib/calculations';

export const STORAGE_KEY_FORWARDER_FEES = 'cd_import_tracker_forwarder_fees_v1';

export type SavedForwarderFees = Partial<
  Record<
    CurrencyCode,
    {
      groupOnlyFee: number;
      unpackAndRepackFee: number;
    }
  >
>;

export function loadFeePresetsForCurrency(curr: CurrencyCode): {
  savedGroup: number;
  savedUnpack: number;
} {
  const meta = CURRENCY_META[curr] || CURRENCY_META.GBP;
  let savedGroup = meta.defaultGroupOnlyFee;
  let savedUnpack = meta.defaultUnpackAndRepackFee;

  try {
    const raw = localStorage.getItem(STORAGE_KEY_FORWARDER_FEES);
    if (raw) {
      const parsed: SavedForwarderFees = JSON.parse(raw);
      if (
        parsed[curr] &&
        typeof parsed[curr]?.groupOnlyFee === 'number' &&
        typeof parsed[curr]?.unpackAndRepackFee === 'number'
      ) {
        savedGroup = parsed[curr]!.groupOnlyFee;
        savedUnpack = parsed[curr]!.unpackAndRepackFee;
      }
    }
  } catch {
    // ignora erro de leitura local
  }

  return { savedGroup, savedUnpack };
}

export function saveFeePresetsForCurrency(
  curr: CurrencyCode,
  groupOnlyFee: number,
  unpackAndRepackFee: number
): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_FORWARDER_FEES);
    const parsed: SavedForwarderFees = raw ? JSON.parse(raw) : {};
    parsed[curr] = {
      groupOnlyFee: Math.max(0, groupOnlyFee),
      unpackAndRepackFee: Math.max(0, unpackAndRepackFee),
    };
    localStorage.setItem(STORAGE_KEY_FORWARDER_FEES, JSON.stringify(parsed));
  } catch {
    // ignora falha de gravação local
  }
}
