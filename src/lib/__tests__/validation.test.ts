import { describe, it, expect } from 'vitest';
import { validateTrackerPayload } from '../validation';
import { Shipment, CDItem } from '@/types/tracker';

describe('validateTrackerPayload', () => {
  const validShipment: Shipment = {
    id: 'ship-1',
    name: 'Pacote Teste',
    shippingDate: '2026-10-29',
    status: 'comprado',
    currency: 'GBP',
    exchangeRate: 7.25,
    internalShipping: 0,
    forwarderFee: 0,
    internationalShipping: 0,
    customsTaxBrl: 0,
    isTaxEstimated: false,
    createdAt: '2026-10-29T12:00:00Z',
  };

  const validCdItem: CDItem = {
    id: 'cd-1',
    shipmentId: 'ship-1',
    artist: 'HIM',
    albumTitle: 'Razorblade Romance',
    discCount: 1,
    isBundle: false,
    unitOriginalValue: 12.5,
    createdAt: '2026-10-29T12:00:00Z',
  };

  it('deve aprovar payload válido de shipments e cdItems', () => {
    const res = validateTrackerPayload({
      shipments: [validShipment],
      cdItems: [validCdItem],
    });
    expect(res.success).toBe(true);
    expect(res.data?.shipments.length).toBe(1);
    expect(res.data?.cdItems.length).toBe(1);
  });

  it('deve rejeitar se shipments não for array', () => {
    const res = validateTrackerPayload({
      shipments: null,
      cdItems: [validCdItem],
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/shipments/);
  });

  it('deve rejeitar se cdItems não for array', () => {
    const res = validateTrackerPayload({
      shipments: [validShipment],
      cdItems: 'invalid',
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/cdItems/);
  });

  it('deve rejeitar shipment com moeda inválida', () => {
    const res = validateTrackerPayload({
      shipments: [{ ...validShipment, currency: 'XYZ' }],
      cdItems: [validCdItem],
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/moeda inválida/);
  });

  it('deve rejeitar cdItem com unitOriginalValue não numérico', () => {
    const res = validateTrackerPayload({
      shipments: [validShipment],
      cdItems: [{ ...validCdItem, unitOriginalValue: 'dez' }],
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/unitOriginalValue/);
  });
});
