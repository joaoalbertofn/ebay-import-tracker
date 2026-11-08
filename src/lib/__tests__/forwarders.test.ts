import { describe, expect, it } from 'vitest';
import {
  getAllForwarders,
  getForwarderById,
  getForwardersSortedForCurrency,
  getPackageMapRoute,
  hasSelectedForwarder,
} from '@/lib/domain/forwarders';
import { executeConsolidation } from '@/lib/domain/consolidation';
import { Shipment } from '@/types/tracker';

const makeShipment = (overrides: Partial<Shipment> = {}): Shipment => ({
  id: 'ship-1',
  name: '[Lote] Mudvayne - Deftones',
  shippingDate: '2026-11-01',
  status: 'comprado',
  currency: 'GBP',
  exchangeRate: 7.4,
  internalShipping: 0,
  forwarderFee: 0,
  internationalShipping: 0,
  customsTaxBrl: 0,
  isTaxEstimated: false,
  createdAt: '2026-11-01T12:00:00Z',
  ...overrides,
});

describe('Domínio de Redirecionadores e Mapa-Múndi', () => {
  it('lista ForwardVia, Send2Hub e UsCloser com taxas padrão e prioriza por moeda', () => {
    const all = getAllForwarders();
    expect(all.map((f) => f.id)).toEqual(['forwardvia', 'send2hub', 'uscloser']);

    const ukSorted = getForwardersSortedForCurrency('GBP');
    expect(ukSorted[0].id).toBe('forwardvia');
    expect(ukSorted[1].id).toBe('send2hub');

    const usSorted = getForwardersSortedForCurrency('USD');
    expect(usSorted[0].id).toBe('uscloser');

    expect(getForwarderById('send2hub')?.defaultUnpackAndRepackFee).toBe(0);
    expect(getForwarderById('forwardvia')?.defaultUnpackAndRepackFee).toBe(3.6);
    expect(getForwarderById('uscloser')?.defaultUnpackAndRepackFee).toBe(4.0);
  });

  it('valida elegibilidade de consolidação exigindo redirecionador selecionado', () => {
    expect(hasSelectedForwarder({ forwarderId: undefined })).toBe(false);
    expect(hasSelectedForwarder({ forwarderId: '' })).toBe(false);
    expect(hasSelectedForwarder({ forwarderId: 'send2hub' })).toBe(true);
    expect(hasSelectedForwarder({ forwarderId: 'uscloser' })).toBe(true);
  });

  it('calcula a posição, a rota e a pilha (stackKey) do pacote no mapa de acordo com status e redirecionador', () => {
    const sComprado = makeShipment({ status: 'comprado', currency: 'GBP' });
    const routeComprado = getPackageMapRoute(sComprado);
    expect(routeComprado.currentWaypointIndex).toBe(0);
    expect(routeComprado.currentWaypoint.id).toBe('origin');
    expect(routeComprado.originCountryName).toBe('Reino Unido');
    expect(routeComprado.stackKey).toBe('origin_GBP');

    const sRedir = makeShipment({
      status: 'no_redirecionador',
      currency: 'GBP',
      forwarderId: 'send2hub',
    });
    const routeRedir = getPackageMapRoute(sRedir);
    expect(routeRedir.currentWaypointIndex).toBe(1);
    expect(routeRedir.currentWaypoint.id).toBe('forwarder');
    expect(routeRedir.forwarder?.name).toBe('Send2Hub');
    expect(routeRedir.stackKey).toBe('forwarder_GBP');
    // Garante que a pilha do Vendedor UK e a pilha do Redirecionador UK ficam lado a lado sem sobreposição
    expect(routeComprado.stackAnchor.x).not.toBe(routeRedir.stackAnchor.x);

    const sTransito = makeShipment({
      status: 'em_transito',
      currency: 'USD',
      forwarderId: 'uscloser',
    });
    const routeTransito = getPackageMapRoute(sTransito);
    expect(routeTransito.currentWaypointIndex).toBe(2);
    expect(routeTransito.currentWaypoint.id).toBe('transit');
    expect(routeTransito.stackKey).toBe('transit_USD');

    const sTributado = makeShipment({ status: 'tributado' });
    const routeTributado = getPackageMapRoute(sTributado);
    expect(routeTributado.currentWaypoint.id).toBe('customs');
    expect(routeTributado.stackKey).toBe('customs_BR');

    const sEntregue = makeShipment({ status: 'entregue' });
    const routeEntregue = getPackageMapRoute(sEntregue);
    expect(routeEntregue.currentWaypoint.id).toBe('destination');
    expect(routeEntregue.stackKey).toBe('destination_BR');
    // Garante que a pilha de Curitiba e a pilha de Minas Gerais ficam lado a lado sem colisão
    expect(routeTributado.stackAnchor.x).not.toBe(routeEntregue.stackAnchor.x);
  });

  it('herda e preserva o forwarderId dos pacotes de origem ao consolidar', () => {
    const pkg1 = makeShipment({
      id: 'pkg-1',
      status: 'no_redirecionador',
      forwarderId: 'send2hub',
    });
    const cd1 = {
      id: 'cd-1',
      shipmentId: 'pkg-1',
      artist: 'HIM',
      albumTitle: 'Love Metal',
      discCount: 1,
      isBundle: false,
      unitOriginalValue: 5,
      createdAt: '2026-11-01T12:00:00Z',
    };

    const result = executeConsolidation({
      allShipments: [pkg1],
      allCdItems: [cd1],
      forwarderPackages: [{ shipment: pkg1, items: [cd1] }],
      targetShipmentData: {
        name: 'Caixa Consolidada UK',
        shippingDate: '2026-11-05',
        status: 'consolidado',
        currency: 'GBP',
        exchangeRate: 7.4,
        internalShipping: 0,
        forwarderFee: 0,
        internationalShipping: 25.71,
        customsTaxBrl: 0,
        isTaxEstimated: false,
      },
      targetShipmentId: 'consolidated-1',
      isExistingShipment: false,
      absorbedPayload: {
        selectedCdIds: ['cd-1'],
        discardedCdIds: [],
        mode: 'unpack_and_repack',
      },
    });

    const createdConsolidated = result.updatedShipments.find(
      (s) => s.id === 'consolidated-1'
    );
    expect(createdConsolidated?.forwarderId).toBe('send2hub');
    expect(createdConsolidated?.status).toBe('consolidado');
  });
});
