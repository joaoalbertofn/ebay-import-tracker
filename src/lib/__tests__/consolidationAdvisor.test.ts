import { describe, expect, it } from 'vitest';
import {
  evaluateForwarderPackage,
  generateConsolidationAdvisorReport,
} from '@/lib/domain/consolidationAdvisor';
import { ForwarderPackageOption } from '@/lib/domain/consolidation';
import { CDItem, Shipment } from '@/types/tracker';

function makePackage(
  id: string,
  name: string,
  status: Shipment['status'],
  cdPrices: number[],
  weightKg?: number,
  internalShipping = 0
): ForwarderPackageOption {
  const shipment: Shipment = {
    id,
    name,
    shippingDate: '2026-10-28',
    status,
    currency: 'GBP',
    exchangeRate: 7.0,
    consolidationMode: 'direct',
    weightKg,
    internalShipping,
    forwarderFee: 0,
    internationalShipping: 0,
    customsTaxBrl: 0,
    isTaxEstimated: false,
    createdAt: '2026-10-28T12:00:00.000Z',
  };

  const items: CDItem[] = cdPrices.map((price, idx) => ({
    id: `${id}-cd-${idx}`,
    shipmentId: id,
    currency: 'GBP',
    artist: `Artist ${idx}`,
    albumTitle: `Album ${idx}`,
    discCount: 1,
    isBundle: cdPrices.length > 1,
    unitOriginalValue: price,
    createdAt: '2026-10-28T12:00:00.000Z',
  }));

  return { shipment, items };
}

describe('consolidationAdvisor', () => {
  it('usa peso real quando cadastrado e estima ~110g/disco quando ausente', () => {
    const withRealWeight = makePackage(
      'ship-1',
      'Pacote Peso Real',
      'no_redirecionador',
      [5, 5],
      0.35
    );
    const withoutWeight = makePackage(
      'ship-2',
      'Pacote Sem Peso',
      'comprado',
      [4, 4, 4]
    );

    const evalReal = evaluateForwarderPackage(withRealWeight);
    expect(evalReal.weightKg).toBe(0.35);
    expect(evalReal.isWeightEstimated).toBe(false);
    expect(evalReal.cdCount).toBe(2);

    const evalEst = evaluateForwarderPackage(withoutWeight);
    expect(evalEst.weightKg).toBe(0.33); // 3 * 110g = 0.33kg
    expect(evalEst.isWeightEstimated).toBe(true);
    expect(evalEst.cdCount).toBe(3);
  });

  it('filtra apenas no_redirecionador por padrão e inclui comprados quando habilitado', () => {
    const packages: ForwarderPackageOption[] = [
      makePackage('fwd-1', 'Lote Redir 1', 'no_redirecionador', [3, 3], 0.3),
      makePackage('fwd-2', 'CD Redir 2', 'no_redirecionador', [4], 0.2),
      makePackage('buy-1', 'Lote Comprado 1', 'comprado', [3, 3, 3, 3]), // ~0.44kg
    ];

    const defaultReport = generateConsolidationAdvisorReport(packages, {
      targetMaxWeightKg: 1.0,
      includePurchasedInTransit: false,
    });

    expect(defaultReport.inForwarderCount).toBe(2);
    expect(defaultReport.purchasedInTransitCount).toBe(1);
    expect(defaultReport.eligiblePool).toHaveLength(2);
    expect(defaultReport.remainingCapacityInForwarderKg).toBe(0.5);
    expect(defaultReport.suggestions).toHaveLength(1);
    expect(defaultReport.suggestions[0].packageIds).toEqual(['fwd-1', 'fwd-2']);

    const fullReport = generateConsolidationAdvisorReport(packages, {
      targetMaxWeightKg: 1.0,
      includePurchasedInTransit: true,
    });

    expect(fullReport.eligiblePool).toHaveLength(3);
    // Todos os 3 juntos somam 0.3 + 0.2 + 0.44 = 0.94kg <= 1.0kg (7 CDs)
    expect(fullReport.suggestions[0].totalCds).toBe(7);
    expect(fullReport.suggestions[0].totalWeightKg).toBe(0.94);
  });

  it('prioriza lotes com mais CDs para diluir a taxa do redirecionador e o frete dentro da meta de 1.0kg', () => {
    const packages: ForwarderPackageOption[] = [
      makePackage('lot-4', 'Lote 4 CDs', 'no_redirecionador', [3, 3, 3, 3], 0.44),
      makePackage('lot-3', 'Lote 3 CDs', 'no_redirecionador', [3, 3, 3], 0.33),
      makePackage('lot-2', 'Lote 2 CDs', 'no_redirecionador', [3, 3], 0.22),
      makePackage('single-1', 'Avulso 1', 'no_redirecionador', [5], 0.2),
      makePackage('single-2', 'Avulso 2', 'no_redirecionador', [5], 0.2),
    ];

    const report = generateConsolidationAdvisorReport(packages, {
      targetMaxWeightKg: 1.0,
      includePurchasedInTransit: false,
      mode: 'unpack_and_repack',
      currency: 'GBP',
      exchangeRate: 7.0,
      unpackAndRepackFeeUnit: 3.6,
      estimatedIntlShippingOverride: 37.0,
    });

    expect(report.suggestions.length).toBeGreaterThan(0);
    const best = report.suggestions[0];

    // Melhor combinação dentro de 1.0kg: lot-4 (0.44) + lot-3 (0.33) + lot-2 (0.22) = 0.99kg com 9 CDs em 3 pacotes!
    expect(best.packageIds).toEqual(['lot-4', 'lot-3', 'lot-2']);
    expect(best.totalCds).toBe(9);
    expect(best.totalWeightKg).toBe(0.99);
    expect(best.exceedsTargetWeight).toBe(false);
    // Taxa = 3 * 3.6 = 10.80 + Frete 37.00 = 47.80 / 9 = £5.31 por CD
    expect(best.consolidationAndIntlPerCdOriginal).toBeCloseTo(5.31, 2);
  });
});
