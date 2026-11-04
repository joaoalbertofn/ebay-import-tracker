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
  it('desconta o peso da embalagem original no modo unpack_and_repack (~130g/CD) e mantém o peso bruto no modo group_only', () => {
    const withRealWeight = makePackage(
      'ship-1',
      'Pacote 2 CDs com Caixa (300g bruto)',
      'no_redirecionador',
      [5, 5],
      0.3
    );
    const withoutWeight = makePackage(
      'ship-2',
      'Pacote Sem Peso (3 CDs)',
      'comprado',
      [4, 4, 4]
    );

    const evalUnpack = evaluateForwarderPackage(
      withRealWeight,
      130,
      'unpack_and_repack'
    );
    expect(evalUnpack.weightKg).toBe(0.26); // 2 * 130g = 0.26kg (descontou 40g da caixa)
    expect(evalUnpack.rawRegisteredWeightKg).toBe(0.3);
    expect(evalUnpack.savedPackagingWeightKg).toBe(0.04);
    expect(evalUnpack.isWeightEstimated).toBe(true);
    expect(evalUnpack.cdCount).toBe(2);

    const evalGroupOnly = evaluateForwarderPackage(
      withRealWeight,
      130,
      'group_only'
    );
    expect(evalGroupOnly.weightKg).toBe(0.3);
    expect(evalGroupOnly.savedPackagingWeightKg).toBe(0);
    expect(evalGroupOnly.isWeightEstimated).toBe(false);

    const evalEst = evaluateForwarderPackage(withoutWeight);
    expect(evalEst.weightKg).toBe(0.39); // 3 * 130g = 0.39kg
    expect(evalEst.isWeightEstimated).toBe(true);
    expect(evalEst.cdCount).toBe(3);
  });

  it('filtra apenas no_redirecionador por padrão e inclui comprados quando habilitado', () => {
    const packages: ForwarderPackageOption[] = [
      makePackage('fwd-1', 'Lote Redir 1', 'no_redirecionador', [3, 3], 0.3), // 0.26kg líquido
      makePackage('fwd-2', 'CD Redir 2', 'no_redirecionador', [4], 0.2), // 0.13kg líquido
      makePackage('buy-1', 'Lote Comprado 1', 'comprado', [3, 3, 3, 3]), // 0.52kg líquido
    ];

    const defaultReport = generateConsolidationAdvisorReport(packages, {
      targetMaxWeightKg: 1.3,
      includePurchasedInTransit: false,
    });

    expect(defaultReport.inForwarderCount).toBe(2);
    expect(defaultReport.purchasedInTransitCount).toBe(1);
    expect(defaultReport.eligiblePool).toHaveLength(2);
    expect(defaultReport.remainingCapacityInForwarderKg).toBe(0.91);
    expect(defaultReport.suggestions).toHaveLength(1);
    expect(defaultReport.suggestions[0].packageIds).toEqual(['fwd-1', 'fwd-2']);

    const fullReport = generateConsolidationAdvisorReport(packages, {
      targetMaxWeightKg: 1.3,
      includePurchasedInTransit: true,
    });

    expect(fullReport.eligiblePool).toHaveLength(3);
    // Todos os 3 juntos somam 0.26 + 0.13 + 0.52 = 0.91kg <= 1.3kg (7 CDs)
    expect(fullReport.suggestions[0].totalCds).toBe(7);
    expect(fullReport.suggestions[0].totalWeightKg).toBe(0.91);
  });

  it('seleciona os 3 lotes (10 CDs = 1.30kg líquido) quando os pacotes brutos somavam 1.40kg com embalagens', () => {
    const packages: ForwarderPackageOption[] = [
      makePackage(
        'him-6',
        '[Lote] HIM',
        'comprado',
        [3, 3, 3, 3, 3, 3],
        0.8,
        0
      ),
      makePackage(
        'lp-pr-2',
        '[Lote] Linkin Park - Papa Roach',
        'comprado',
        [5.11, 1.54],
        0.3,
        0
      ),
      makePackage(
        'him-soad-2',
        '[Lote] HIM - System of a Down',
        'comprado',
        [3, 4.49],
        0.3,
        3
      ),
      makePackage('deftones-1', '[CD Individual] Deftones', 'comprado', [8], 0.2, 0),
      makePackage(
        'hybrid-1',
        '[CD Individual] Hybrid Theory',
        'comprado',
        [3.86],
        0.2,
        2.7
      ),
    ];

    const report = generateConsolidationAdvisorReport(packages, {
      targetMaxWeightKg: 1.3,
      includePurchasedInTransit: true,
      mode: 'unpack_and_repack',
      currency: 'GBP',
      exchangeRate: 7.15,
      unpackAndRepackFeeUnit: 3.6,
      estimatedIntlShippingOverride: 41.0,
    });

    expect(report.suggestions.length).toBeGreaterThan(0);
    const best = report.suggestions[0];

    // Os 3 lotes somam 6 + 2 + 2 = 10 CDs (0.78 + 0.26 + 0.26 = 1.30kg), descontando 0.10kg de embalagens!
    expect(best.packageIds).toEqual(['him-6', 'lp-pr-2', 'him-soad-2']);
    expect(best.totalCds).toBe(10);
    expect(best.totalWeightKg).toBe(1.3);
    expect(best.totalSavedPackagingWeightKg).toBe(0.1);
    expect(best.exceedsTargetWeight).toBe(false);
    // Taxa = 3 * 3.6 = 10.80 + Frete 41.00 = 51.80 / 10 = £5.18 por CD
    expect(best.consolidationAndIntlPerCdOriginal).toBeCloseTo(5.18, 2);
  });
});
