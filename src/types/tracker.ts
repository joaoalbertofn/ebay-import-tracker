export type CurrencyCode = 'GBP' | 'USD' | 'EUR' | 'JPY' | 'BRL';

export type ShipmentStatus =
  | 'comprado'
  | 'no_redirecionador'
  | 'consolidado'
  | 'em_transito'
  | 'tributado'
  | 'entregue';

export type ConsolidationMode =
  | 'direct' // Compra única enviada direto sem agrupar
  | 'group_only' // Opção 1: Apenas agrupar pacotes originais em um novo volume
  | 'unpack_and_repack'; // Opção 2: Desempacotar caixas originais + criar novo volume

export const LOCKER_SHIPMENT_ID = 'LOCKER';

export interface Shipment {
  id: string;
  name: string;
  shippingDate: string; // YYYY-MM-DD ou vazio se ainda não enviado
  status: ShipmentStatus;
  currency: CurrencyCode;
  exchangeRate: number; // Cotação automática da Moeda Original para BRL
  exchangeRateSource?: string; // Ex: "AwesomeAPI (Comercial) às 14:30"
  consolidationMode?: ConsolidationMode; // Como este pacote foi formado no redirecionador
  sourcePackagesCount?: number; // Quantos pacotes do eBay foram consolidados neste volume
  unpackingFee?: number; // Taxa de desempacotamento (na Moeda Original)
  groupingFee?: number; // Taxa de agrupamento / novo volume (na Moeda Original)
  internalShipping: number; // Frete interno avulso no nível do pacote (na Moeda Original)
  forwarderFee: number; // Taxa total do redirecionador (desempacotamento + agrupamento na Moeda Original)
  internationalShipping: number; // Frete internacional para o Brasil (na Moeda Original)
  customsTaxBrl: number; // Impostos Alfandegários (II + ICMS) em BRL
  isTaxEstimated: boolean; // Indica se o imposto atual é uma estimativa (0.9277) ou valor real da DIT
  postalFeeBrl: number; // Taxa de despacho postal dos Correios em BRL (Padrão: R$ 18,10)
  internationalTrackingCode?: string; // Código de rastreio do redirecionador para o Brasil
  notes?: string;
  createdAt: string;
}

export interface CDItem {
  id: string;
  shipmentId: string; // ID do Pacote para o Brasil ou 'LOCKER' quando está no Cofre do Redirecionador
  currency?: CurrencyCode; // Moeda da compra no eBay (usada especialmente enquanto está no Cofre)
  artist: string;
  albumTitle: string;
  discCount: number; // 1 para CD simples, 2 para duplo, N para Box Set
  isBundle: boolean; // Comprado em Bundle (lote com vários CDs no eBay)?
  bundleId?: string; // Identificador do pacote/compra original do eBay
  bundleName?: string; // Ex: "Lote 5 CDs Post-Hardcore Vendedor X"
  bundleTotalValue?: number; // Valor total pago no bundle (na moeda original)
  bundleTotalQuantity?: number; // Quantidade total de CDs comprados naquele pacote do eBay
  bundleInternalShipping?: number; // Frete interno total daquela compra no eBay até o redirecionador
  unitInternalShipping?: number; // Frete interno diluído por CD (permite desmembrar lotes em pacotes diferentes)
  packingHandling?: 'original_box' | 'unpacked'; // Se foi mantido na caixa original ou tirado da caixa no redirecionador
  isConsolidated?: boolean; // Indica se este CD já foi consolidado em um pacote (bloqueado para nova consolidação)
  localTrackingCode?: string; // Código de rastreio local (vendedor -> redirecionador)
  unitOriginalValue: number; // Valor_Unitario_Original (na moeda original)
  coverUrl?: string; // URL da capa do álbum (buscada via iTunes / Cover Art Archive ou manual)
  releaseYear?: string; // Ano de lançamento do álbum
  createdAt: string;
}

export interface CalculatedCDItem extends CDItem {
  directCostBrl: number; // Valor_Unitario_Original * Taxa de Câmbio
  unitInternalShippingOriginal: number; // Frete interno específico carregado por este CD
  allocatedIndirectCostBrl: number; // Rateio por CD em BRL
  finalCostBrl: number; // Custo_Final_BRL = directCostBrl + allocatedIndirectCostBrl
  costPerDiscBrl: number; // Caso seja CD duplo/BoxSet, mostra também o custo por disco físico dentro do box
}

export interface ShipmentCalculationSummary {
  shipment: Shipment;
  items: CalculatedCDItem[];
  totalItemsCount: number; // Quantidade de itens (registros de CD/Box) cadastrados no pacote
  totalPhysicalDiscsCount: number; // Soma de discCount
  // Custos Diretos (CDs)
  totalItemsOriginal: number; // Soma dos unitOriginalValue na moeda original
  totalItemsBrl: number; // Soma dos CDs convertida para BRL
  // Custos Indiretos de Frete/Redirecionador na Moeda Original
  bundlesInternalShippingOriginal: number; // Soma dos fretes locais dos CDs que compõem este pacote
  totalInternalShippingOriginal: number; // shipment.internalShipping + bundlesInternalShippingOriginal
  totalOriginIndirectOriginal: number; // totalInternalShippingOriginal + forwarderFee + internationalShipping
  totalOriginIndirectBrl: number; // totalOriginIndirectOriginal * exchangeRate
  // Custos Indiretos Totais (BRL)
  totalIndirectCostBrl: number; // totalOriginIndirectBrl + customsTaxBrl + postalFeeBrl
  // Rateio Unitário (Regra 2)
  allocatedCostPerItemBrl: number; // totalIndirectCostBrl / totalItemsCount
  // Custo Total do Pacote (BRL)
  totalShipmentCostBrl: number; // totalItemsBrl + totalIndirectCostBrl
  // Estimativa MG (Regra 4: 0.9277)
  estimatedTaxMgBrl: number; // ((totalItemsOriginal + internationalShipping) * exchangeRate) * 0.9277
}
