import { CDItem, CurrencyCode, Shipment, ShipmentStatus } from '@/types/tracker';

const VALID_CURRENCIES: Set<CurrencyCode> = new Set([
  'GBP',
  'USD',
  'EUR',
  'JPY',
  'BRL',
]);

const VALID_STATUSES: Set<ShipmentStatus> = new Set([
  'comprado',
  'no_redirecionador',
  'consolidado',
  'em_transito',
  'tributado',
  'entregue',
]);

export interface ValidationResult {
  success: boolean;
  error?: string;
  data?: {
    shipments: Shipment[];
    cdItems: CDItem[];
  };
}

export function validateTrackerPayload(payload: unknown): ValidationResult {
  if (!payload || typeof payload !== 'object') {
    return { success: false, error: 'O payload precisa ser um objeto válido.' };
  }

  const { shipments, cdItems } = payload as Record<string, unknown>;

  if (!Array.isArray(shipments)) {
    return {
      success: false,
      error: 'Campo "shipments" obrigatório e deve ser um array.',
    };
  }

  if (!Array.isArray(cdItems)) {
    return {
      success: false,
      error: 'Campo "cdItems" obrigatório e deve ser um array.',
    };
  }

  for (let i = 0; i < shipments.length; i++) {
    const s = shipments[i];
    if (!s || typeof s !== 'object') {
      return { success: false, error: `Shipment no índice ${i} é inválido.` };
    }
    if (typeof s.id !== 'string' || !s.id.trim()) {
      return {
        success: false,
        error: `Shipment no índice ${i} deve ter um "id" string válido.`,
      };
    }
    if (typeof s.name !== 'string') {
      return {
        success: false,
        error: `Shipment "${s.id}" deve ter um "name" válido.`,
      };
    }
    if (!VALID_CURRENCIES.has(s.currency)) {
      return {
        success: false,
        error: `Shipment "${s.id}" tem moeda inválida: "${s.currency}".`,
      };
    }
    if (!VALID_STATUSES.has(s.status)) {
      return {
        success: false,
        error: `Shipment "${s.id}" tem status inválido: "${s.status}".`,
      };
    }
    if (typeof s.exchangeRate !== 'number' || !Number.isFinite(s.exchangeRate)) {
      return {
        success: false,
        error: `Shipment "${s.id}" deve ter um exchangeRate numérico válido.`,
      };
    }
  }

  for (let i = 0; i < cdItems.length; i++) {
    const cd = cdItems[i];
    if (!cd || typeof cd !== 'object') {
      return { success: false, error: `CDItem no índice ${i} é inválido.` };
    }
    if (typeof cd.id !== 'string' || !cd.id.trim()) {
      return {
        success: false,
        error: `CDItem no índice ${i} deve ter um "id" string válido.`,
      };
    }
    if (typeof cd.shipmentId !== 'string' || !cd.shipmentId.trim()) {
      return {
        success: false,
        error: `CDItem "${cd.id}" deve pertencer a um "shipmentId" válido.`,
      };
    }
    if (typeof cd.artist !== 'string') {
      return {
        success: false,
        error: `CDItem "${cd.id}" deve conter o campo "artist".`,
      };
    }
    if (typeof cd.albumTitle !== 'string') {
      return {
        success: false,
        error: `CDItem "${cd.id}" deve conter o campo "albumTitle".`,
      };
    }
    if (
      typeof cd.unitOriginalValue !== 'number' ||
      !Number.isFinite(cd.unitOriginalValue)
    ) {
      return {
        success: false,
        error: `CDItem "${cd.id}" deve conter um "unitOriginalValue" numérico válido.`,
      };
    }
  }

  return {
    success: true,
    data: {
      shipments: shipments as Shipment[],
      cdItems: cdItems as CDItem[],
    },
  };
}
