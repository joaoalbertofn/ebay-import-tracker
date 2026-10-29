import { describe, expect, it } from 'vitest';
import {
  calculateConsolidationFee,
  calculateInheritedInternalShipping,
  calculateSelectedForwarderCdsValue,
  countSourcePackagesForSelectedCds,
  executeConsolidation,
  extractCdToSingleShipment,
  ForwarderPackageOption,
} from '@/lib/domain/consolidation';
import { CDItem, Shipment } from '@/types/tracker';

describe('domain/consolidation.ts — Consolidação e Desmembramento', () => {
  const pkg1Shipment: Shipment = {
    id: 'ship-source-1',
    name: 'Pacote Origem 1 (GBP)',
    shippingDate: '2026-10-20',
    status: 'no_redirecionador',
    currency: 'GBP',
    exchangeRate: 7.5,
    internalShipping: 3.0, // £ 3.00 no pacote
    forwarderFee: 0,
    internationalShipping: 0,
    customsTaxBrl: 0,
    isTaxEstimated: false,
    createdAt: '2026-10-20T10:00:00.000Z',
  };

  const pkg1Items: CDItem[] = [
    {
      id: 'cd-src-1',
      shipmentId: 'ship-source-1',
      artist: 'Korn',
      albumTitle: 'Life is Peachy',
      unitOriginalValue: 10.0,
      discCount: 1,
      isBundle: false,
      createdAt: '2026-10-20T10:00:00.000Z',
    },
    {
      id: 'cd-src-2',
      shipmentId: 'ship-source-1',
      artist: 'Korn',
      albumTitle: 'Issues',
      unitOriginalValue: 10.0,
      discCount: 1,
      isBundle: false,
      createdAt: '2026-10-20T10:00:00.000Z',
    },
  ];

  const eligibleOptions: ForwarderPackageOption[] = [
    {
      shipment: pkg1Shipment,
      items: pkg1Items,
    },
  ];

  it('deve calcular o frete herdado proporcionalmente para pacotes na mesma moeda', () => {
    const selectedIds = new Set(['cd-src-1']);
    const discardedIds = new Set<string>();

    // 1 de 2 CDs selecionados -> 50% de £ 3.00 = £ 1.50
    const inherited = calculateInheritedInternalShipping(
      eligibleOptions,
      selectedIds,
      discardedIds,
      'GBP',
      7.5
    );
    expect(inherited).toBe(1.5);
  });

  it('deve calcular o frete herdado com conversão multimoeda correta (GBP para USD)', () => {
    const selectedIds = new Set(['cd-src-1', 'cd-src-2']);
    const discardedIds = new Set<string>();

    // Ambos os CDs selecionados. Origem: GBP (7.50). Destino: USD (5.00).
    // Fator = 7.50 / 5.00 = 1.5. £ 3.00 * 1.5 = US$ 4.50
    const inherited = calculateInheritedInternalShipping(
      eligibleOptions,
      selectedIds,
      discardedIds,
      'USD',
      5.0
    );
    expect(inherited).toBe(4.5);
  });

  it('deve calcular a soma dos CDs com redistribuição em caso de descarte', () => {
    const selectedIds = new Set(['cd-src-1']); // Mantém cd-src-1
    const discardedIds = new Set(['cd-src-2']); // Descarta cd-src-2

    // Total original do pacote era 10 + 10 = £ 20.00.
    // Como descartou 1 de 2 CDs, o sobrevivente absorve os £ 20.00 inteiros!
    const value = calculateSelectedForwarderCdsValue(
      eligibleOptions,
      selectedIds,
      discardedIds,
      'GBP',
      7.5
    );
    expect(value).toBe(20.0);
  });

  it('deve calcular a taxa de consolidação de acordo com os presets e modo', () => {
    const selectedIds = new Set(['cd-src-1']);
    const sourceCount = countSourcePackagesForSelectedCds(
      eligibleOptions,
      selectedIds
    );
    expect(sourceCount).toBe(1);

    const feeGroupOnly = calculateConsolidationFee(
      sourceCount,
      'group_only',
      2.4,
      3.6
    );
    expect(feeGroupOnly).toBe(2.4);

    const feeUnpack = calculateConsolidationFee(
      sourceCount,
      'unpack_and_repack',
      2.4,
      3.6
    );
    expect(feeUnpack).toBe(3.6);
  });

  it('deve executar executeConsolidation gerando pacote consolidado e absorvendo pacote de origem', () => {
    const targetShipmentData: Omit<Shipment, 'id' | 'createdAt'> = {
      name: '[Lote] Korn Consolidado',
      shippingDate: '2026-10-29',
      status: 'consolidado',
      currency: 'GBP',
      exchangeRate: 7.5,
      consolidationMode: 'group_only',
      internalShipping: 3.0,
      forwarderFee: 2.4,
      internationalShipping: 12.0,
      customsTaxBrl: 0,
      isTaxEstimated: false,
    };

    const result = executeConsolidation({
      allShipments: [pkg1Shipment],
      allCdItems: pkg1Items,
      forwarderPackages: eligibleOptions,
      targetShipmentData,
      targetShipmentId: 'ship-target-consolidated',
      isExistingShipment: false,
      absorbedPayload: {
        selectedCdIds: ['cd-src-1', 'cd-src-2'],
        discardedCdIds: [],
        mode: 'group_only',
      },
    });

    expect(result.absorbedCount).toBe(2);
    expect(result.discardedCount).toBe(0);

    // O pacote de origem foi 100% absorvido, portanto deve ter sido removido
    expect(
      result.updatedShipments.some((s) => s.id === 'ship-source-1')
    ).toBe(false);
    // O novo pacote consolidado deve estar presente
    expect(
      result.updatedShipments.some((s) => s.id === 'ship-target-consolidated')
    ).toBe(true);

    // Todos os CDs absorvidos devem apontar para o novo pacote e ter isConsolidated: true
    const consolidatedCDs = result.updatedCdItems.filter(
      (cd) => cd.shipmentId === 'ship-target-consolidated'
    );
    expect(consolidatedCDs.length).toBe(2);
    expect(consolidatedCDs.every((cd) => cd.isConsolidated)).toBe(true);
  });

  it('deve desmembrar um CD para pacote único com extractCdToSingleShipment', () => {
    const itemToExtract = pkg1Items[0];
    const { newShipment, updatedCd } = extractCdToSingleShipment(
      itemToExtract,
      pkg1Shipment
    );

    expect(newShipment.status).toBe('comprado');
    expect(newShipment.consolidationMode).toBe('direct');
    expect(updatedCd.shipmentId).toBe(newShipment.id);
    expect(updatedCd.isConsolidated).toBe(false);
  });
});
