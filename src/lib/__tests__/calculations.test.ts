import { describe, expect, it } from 'vitest';
import {
  MG_TAX_FACTOR,
  calculateAllShipmentSummaries,
  calculateShipmentSummary,
  formatBrl,
  formatOriginalCurrency,
  formatWeightKg,
  generatePackageName,
  getItemUnitInternalShipping,
} from '@/lib/calculations';
import { CDItem, Shipment } from '@/types/tracker';

describe('calculations.ts — Regras Financeiras e Rateio', () => {
  const baseShipment: Shipment = {
    id: 'ship-test-1',
    name: 'Lote Teste 3 CDs',
    shippingDate: '2026-10-29',
    status: 'consolidado',
    currency: 'GBP',
    exchangeRate: 7.5,
    internalShipping: 2.0, // £ 2.00 frete local do pacote
    forwarderFee: 3.6, // £ 3.60 taxa redirecionador
    internationalShipping: 10.0, // £ 10.00 frete intl
    customsTaxBrl: 50.0, // R$ 50.00 taxa Receita
    isTaxEstimated: false,
    weightKg: 0.6,
    createdAt: '2026-10-29T10:00:00.000Z',
  };

  const sampleCDs: CDItem[] = [
    {
      id: 'cd-1',
      shipmentId: 'ship-test-1',
      artist: 'Deftones',
      albumTitle: 'Around the Fur',
      unitOriginalValue: 8.0, // £ 8.00
      discCount: 1,
      isBundle: false,
      createdAt: '2026-10-29T10:00:00.000Z',
    },
    {
      id: 'cd-2',
      shipmentId: 'ship-test-1',
      artist: 'Smashing Pumpkins',
      albumTitle: 'Mellon Collie and the Infinite Sadness',
      unitOriginalValue: 12.0, // £ 12.00
      discCount: 2, // CD Duplo
      isBundle: false,
      createdAt: '2026-10-29T10:00:00.000Z',
    },
    {
      id: 'cd-3',
      shipmentId: 'ship-test-1',
      artist: 'Silverchair',
      albumTitle: 'Neon Ballroom',
      unitOriginalValue: 5.0, // £ 5.00
      discCount: 1,
      isBundle: true,
      bundleId: 'bundle-x',
      bundleTotalQuantity: 2,
      bundleInternalShipping: 3.0, // £ 3.00 no lote de 2 CDs -> £ 1.50 por CD
      createdAt: '2026-10-29T10:00:00.000Z',
    },
  ];

  it('deve calcular corretamente o getItemUnitInternalShipping com bundle e divisão proporcional', () => {
    // CD 1 não tem frete interno próprio
    expect(getItemUnitInternalShipping(sampleCDs[0])).toBe(0);

    // CD 3 tem frete no bundle (£ 3.00) dividido por bundleTotalQuantity (2) = £ 1.50
    expect(getItemUnitInternalShipping(sampleCDs[2])).toBe(1.5);

    // Caso tenha unitInternalShipping explícito, deve ter precedência
    const cdWithExplicit: CDItem = {
      ...sampleCDs[2],
      unitInternalShipping: 0.95,
    };
    expect(getItemUnitInternalShipping(cdWithExplicit)).toBe(0.95);
  });

  it('deve calcular o resumo do pacote respeitando estritamente as Regras 1, 2, 3 e 4', () => {
    const summary = calculateShipmentSummary(baseShipment, sampleCDs);

    // Totais de itens e discos físicos
    expect(summary.totalItemsCount).toBe(3);
    expect(summary.totalPhysicalDiscsCount).toBe(4); // 1 + 2 + 1

    // Soma dos valores originais: 8 + 12 + 5 = £ 25.00
    expect(summary.totalItemsOriginal).toBe(25);
    // Convertido para BRL: 25 * 7.50 = R$ 187.50
    expect(summary.totalItemsBrl).toBe(187.5);

    // Fretes internos nos CDs: CD 3 tem 1.50
    expect(summary.bundlesInternalShippingOriginal).toBe(1.5);
    // Frete interno total original: 2.0 (pacote) + 1.5 (CDs) = £ 3.50
    expect(summary.totalInternalShippingOriginal).toBe(3.5);

    // Regra 1: Custo Indireto Total em BRL
    // Total Origem Indireto = 3.5 (interno) + 3.6 (forwarder) + 10.0 (intl) = £ 17.10
    expect(summary.totalOriginIndirectOriginal).toBe(17.1);
    // Em BRL: 17.10 * 7.50 = R$ 128.25
    expect(summary.totalOriginIndirectBrl).toBe(128.25);
    // Custo Indireto Total = 128.25 + 50.00 (alfândega) = R$ 178.25
    expect(summary.totalIndirectCostBrl).toBe(178.25);

    // Regra 2: Rateio Unitário por CD
    // Rateio = 178.25 / 3 = 59.4166666...
    expect(summary.allocatedCostPerItemBrl).toBeCloseTo(178.25 / 3, 4);

    // Regra 3: Custo Final de cada CD
    // CD 1 (Deftones, £ 8): 8 * 7.50 + 59.41666 = 60 + 59.41666 = 119.41666
    const calcCd1 = summary.items.find((i) => i.id === 'cd-1')!;
    expect(calcCd1.directCostBrl).toBe(60);
    expect(calcCd1.allocatedIndirectCostBrl).toBeCloseTo(59.41666, 3);
    expect(calcCd1.finalCostBrl).toBeCloseTo(119.41666, 3);
    expect(calcCd1.costPerDiscBrl).toBeCloseTo(119.41666, 3);

    // CD 2 (Smashing Pumpkins, £ 12, 2 discos): 12 * 7.50 + 59.41666 = 90 + 59.41666 = 149.41666
    // Custo por disco físico: 149.41666 / 2 = 74.70833
    const calcCd2 = summary.items.find((i) => i.id === 'cd-2')!;
    expect(calcCd2.directCostBrl).toBe(90);
    expect(calcCd2.finalCostBrl).toBeCloseTo(149.41666, 3);
    expect(calcCd2.costPerDiscBrl).toBeCloseTo(74.70833, 3);

    // Regra 4: Estimativa de Imposto MG
    // 187.50 * 0.9277 = 173.94375
    expect(summary.estimatedTaxMgBrl).toBeCloseTo(187.5 * MG_TAX_FACTOR, 4);

    // Custo Total do Pacote
    // 187.50 (CDs) + 178.25 (indireto) = 365.75
    expect(summary.totalShipmentCostBrl).toBe(365.75);

    // Métricas de Peso (0.60 kg, 4 discos físicos)
    expect(summary.weightKg).toBe(0.6);
    expect(summary.gramsPerDisc).toBe(150); // (0.60 * 1000) / 4 = 150g/disco
    expect(summary.shippingCostPerKgOriginal).toBeCloseTo(10 / 0.6, 2);
    expect(summary.shippingCostPerKgBrl).toBeCloseTo((10 / 0.6) * 7.5, 2);
  });

  it('deve processar corretamente calculateAllShipmentSummaries em lote para múltiplos pacotes', () => {
    const shipment2: Shipment = {
      ...baseShipment,
      id: 'ship-test-2',
      name: 'Pacote 2',
      internalShipping: 0,
      forwarderFee: 0,
      internationalShipping: 0,
      customsTaxBrl: 0,
    };

    const summariesMap = calculateAllShipmentSummaries(
      [baseShipment, shipment2],
      sampleCDs
    );

    expect(summariesMap.size).toBe(2);
    expect(summariesMap.get('ship-test-1')?.totalItemsCount).toBe(3);
    expect(summariesMap.get('ship-test-2')?.totalItemsCount).toBe(0);
  });

  it('deve gerar nomes de pacotes automáticos precisos', () => {
    // 1 CD
    expect(
      generatePackageName([{ artist: 'Korn', albumTitle: 'Follow the Leader' }])
    ).toBe('[CD Individual] Korn - Follow the Leader');

    // 2 CDs
    expect(
      generatePackageName([
        { artist: 'Deftones', albumTitle: 'White Pony' },
        { artist: 'Korn', albumTitle: 'Issues' },
      ])
    ).toBe('[Lote] Deftones - Korn');

    // CDs do mesmo artista repetidos -> deduplica artista
    expect(
      generatePackageName([
        { artist: 'Deftones', albumTitle: 'White Pony' },
        { artist: 'Deftones', albumTitle: 'Around the Fur' },
      ])
    ).toBe('[Lote] Deftones');

    // Sem itens válidos
    expect(generatePackageName([])).toBe('[CD Individual] Novo CD');
  });

  it('deve formatar valores monetários e peso sem erros de NaN', () => {
    expect(formatBrl(150.5)).toContain('150,50');
    expect(formatBrl(Number.NaN)).toContain('0,00');

    expect(formatOriginalCurrency(10.25, 'GBP')).toContain('10,25');
    expect(formatWeightKg(0.85)).toBe('0,85 kg');
    expect(formatWeightKg(undefined)).toBe('');
  });
});
