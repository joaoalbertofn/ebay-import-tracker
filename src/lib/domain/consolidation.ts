import {
  CDItem,
  CurrencyCode,
  ConsolidationMode,
  Shipment,
} from '@/types/tracker';
import { CURRENCY_META, getItemUnitInternalShipping } from '@/lib/calculations';
import { generatePackageName } from '@/lib/calculations';

export interface ForwarderPackageOption {
  shipment: Shipment;
  items: CDItem[];
}

export interface SurvivorAdjustment {
  extraUnitValueInSourceCurr: number;
  extraUnitShipInSourceCurr: number;
  newBundleQuantity?: number;
  conversionFactorToTarget: number;
}

/**
 * Calcula o frete interno local herdado proporcionalmente dos pacotes disponíveis para consolidação,
 * considerando a conversão de moedas (origem -> destino) e a exclusão/redistribuição de CDs descartados.
 */
export function calculateInheritedInternalShipping(
  eligiblePackages: ForwarderPackageOption[],
  selectedCdIds: Set<string>,
  discardedCdIds: Set<string>,
  targetCurrency: CurrencyCode,
  targetExchangeRate: number
): number {
  if (selectedCdIds.size === 0) return 0;
  const parsedTargetRate = Math.max(0.0001, targetExchangeRate || 1);
  let inherited = 0;

  for (const fp of eligiblePackages) {
    const keptItemsInPkg = fp.items.filter(
      (cd) => !discardedCdIds.has(cd.id)
    );
    const keptCount = keptItemsInPkg.length;
    if (keptCount === 0) continue;

    const selectedCdsInPkg = keptItemsInPkg.filter((cd) =>
      selectedCdIds.has(cd.id)
    ).length;
    if (selectedCdsInPkg === 0) continue;

    const shipLevelInternal = Number(fp.shipment.internalShipping) || 0;
    if (shipLevelInternal > 0) {
      const sourceRate =
        Number(fp.shipment.exchangeRate) ||
        CURRENCY_META[fp.shipment.currency]?.defaultRate ||
        1;
      const conversionFactor =
        fp.shipment.currency === targetCurrency
          ? 1
          : sourceRate / parsedTargetRate;

      inherited +=
        shipLevelInternal *
        conversionFactor *
        (selectedCdsInPkg / keptCount);
    }
  }

  return Number(inherited.toFixed(4));
}

/**
 * Calcula a soma do valor original dos CDs selecionados para consolidação,
 * convertidos para a moeda de destino e redistribuindo o valor pago de eventuais CDs descartados.
 */
export function calculateSelectedForwarderCdsValue(
  eligiblePackages: ForwarderPackageOption[],
  selectedCdIds: Set<string>,
  discardedCdIds: Set<string>,
  targetCurrency: CurrencyCode,
  targetExchangeRate: number
): number {
  if (selectedCdIds.size === 0) return 0;
  const parsedTargetRate = Math.max(0.0001, targetExchangeRate || 1);
  let total = 0;

  for (const fp of eligiblePackages) {
    const nonDiscarded = fp.items.filter(
      (cd) => !discardedCdIds.has(cd.id)
    );
    if (nonDiscarded.length === 0) continue;

    const selectedInPkg = nonDiscarded.filter((cd) =>
      selectedCdIds.has(cd.id)
    );
    if (selectedInPkg.length === 0) continue;

    const sourceRate =
      Number(fp.shipment.exchangeRate) ||
      CURRENCY_META[fp.shipment.currency]?.defaultRate ||
      1;
    const conversionFactor =
      fp.shipment.currency === targetCurrency
        ? 1
        : sourceRate / parsedTargetRate;

    const discardedCount = fp.items.length - nonDiscarded.length;
    if (discardedCount > 0) {
      const pkgTotalOrig = fp.items.reduce(
        (acc, cd) => acc + (Number(cd.unitOriginalValue) || 0),
        0
      );
      const redistributedUnit = pkgTotalOrig / nonDiscarded.length;
      total += redistributedUnit * selectedInPkg.length * conversionFactor;
    } else {
      const selectedSumOrig = selectedInPkg.reduce(
        (acc, cd) => acc + (Number(cd.unitOriginalValue) || 0),
        0
      );
      total += selectedSumOrig * conversionFactor;
    }
  }

  return Number(total.toFixed(2));
}

/**
 * Conta quantos pacotes distintos possuem ao menos um CD selecionado no conjunto informado.
 */
export function countSourcePackagesForSelectedCds(
  eligiblePackages: ForwarderPackageOption[],
  selectedCdIds: Set<string>
): number {
  let count = 0;
  for (const fp of eligiblePackages) {
    if (fp.items.some((cd) => selectedCdIds.has(cd.id))) {
      count++;
    }
  }
  return count;
}

/**
 * Calcula a taxa de consolidação sugerida com base no modo ('group_only' ou 'unpack_and_repack')
 * e na quantidade de pacotes de origem selecionados.
 */
export function calculateConsolidationFee(
  sourcePackagesCount: number,
  mode: ConsolidationMode,
  groupOnlyFeeUnit: number,
  unpackAndRepackFeeUnit: number
): number {
  if (sourcePackagesCount <= 0) return 0;
  const unitFee =
    mode === 'group_only' ? groupOnlyFeeUnit : unpackAndRepackFeeUnit;
  return Number((sourcePackagesCount * unitFee).toFixed(2));
}

export interface ConsolidationExecutionParams {
  allShipments: Shipment[];
  allCdItems: CDItem[];
  forwarderPackages: ForwarderPackageOption[];
  targetShipmentData: Omit<Shipment, 'id' | 'createdAt'>;
  targetShipmentId: string;
  isExistingShipment: boolean;
  absorbedPayload?: {
    selectedCdIds: string[];
    discardedCdIds: string[];
    mode?: ConsolidationMode;
    inheritedInternalShipping?: number;
  };
  newCdEntries?: Array<{
    id?: string;
    artist: string;
    albumTitle: string;
    unitPrice?: number;
    discCount: number;
    coverUrl?: string;
    releaseYear?: string;
    ebayListingUrl?: string;
  }>;
  initialBundleInfo?: {
    enabled: boolean;
    totalValue: number;
    localTrackingCode?: string;
  };
}

export interface ConsolidationExecutionResult {
  updatedShipments: Shipment[];
  updatedCdItems: CDItem[];
  newlyCreatedCDs: CDItem[];
  absorbedCount: number;
  discardedCount: number;
}

/**
 * Executa a consolidação de ponta a ponta:
 * - Processa novos CDs adicionados ou editados no modal
 * - Redistribui valor pago e frete dos CDs descartados entre os sobreviventes do lote
 * - Converte moedas se os pacotes de origem tiverem moedas diferentes do pacote alvo
 * - Ajusta o frete interno dos pacotes de origem parciais ou remove os pacotes 100% absorvidos
 * - Atualiza todas as coleções de forma imutável e determinística
 */
export function executeConsolidation(
  params: ConsolidationExecutionParams
): ConsolidationExecutionResult {
  const {
    allShipments,
    allCdItems,
    forwarderPackages,
    targetShipmentData,
    targetShipmentId,
    isExistingShipment,
    absorbedPayload,
    newCdEntries = [],
    initialBundleInfo,
  } = params;

  const now = Date.now();
  const absorbedSet = new Set(absorbedPayload?.selectedCdIds || []);
  const discardedSet = new Set(absorbedPayload?.discardedCdIds || []);

  const isTargetConsolidated =
    absorbedSet.size > 0 ||
    targetShipmentData.status === 'consolidado' ||
    targetShipmentData.status === 'em_transito' ||
    targetShipmentData.status === 'tributado' ||
    targetShipmentData.status === 'entregue' ||
    targetShipmentData.consolidationMode === 'group_only' ||
    targetShipmentData.consolidationMode === 'unpack_and_repack';

  // 1. Processa novos CDs ou edições no modal
  const newlyCreatedCDs: CDItem[] = [];
  const updatedEntriesById = new Map<string, (typeof newCdEntries)[number]>();

  if (newCdEntries.length > 0) {
    const qty = newCdEntries.length;
    const bundleVal = initialBundleInfo?.totalValue || 0;
    const fallbackUnitVal = Number((bundleVal / qty).toFixed(4));
    const hasDistinctPrices = newCdEntries.some(
      (e, _, arr) => e.unitPrice !== arr[0]?.unitPrice
    );
    const bundleId = `bundle-${now}`;

    newCdEntries.forEach((entry, idx) => {
      const cleanArtist = entry.artist.trim() || targetShipmentData.name;
      const cleanAlbum =
        entry.albumTitle.trim() ||
        (qty === 1
          ? 'Álbum'
          : `CD #${idx + 1} do Lote (${targetShipmentData.name})`);
      const itemUnitVal =
        entry.unitPrice !== undefined
          ? Number(entry.unitPrice.toFixed(4))
          : fallbackUnitVal;

      if (entry.id) {
        updatedEntriesById.set(entry.id, {
          ...entry,
          artist: cleanArtist,
          albumTitle: cleanAlbum,
          unitPrice: itemUnitVal,
          discCount: entry.discCount || 1,
        });
      } else {
        newlyCreatedCDs.push({
          id: `cd-${now}-${idx}`,
          shipmentId: targetShipmentId,
          currency: targetShipmentData.currency,
          artist: cleanArtist,
          albumTitle: cleanAlbum,
          discCount: entry.discCount || 1,
          isBundle: qty > 1 && !hasDistinctPrices,
          bundleId: qty > 1 ? bundleId : undefined,
          bundleName: qty > 1 ? targetShipmentData.name : undefined,
          bundleTotalValue:
            qty > 1 && !hasDistinctPrices ? bundleVal : undefined,
          bundleTotalQuantity: qty > 1 ? qty : undefined,
          bundleInternalShipping: 0,
          unitInternalShipping: 0,
          localTrackingCode: initialBundleInfo?.localTrackingCode || '',
          ebayOrderId: targetShipmentData.ebayOrderId,
          ebayOrderUrl: targetShipmentData.ebayOrderUrl,
          ebayListingUrl: entry.ebayListingUrl,
          unitOriginalValue: itemUnitVal,
          coverUrl: entry.coverUrl,
          releaseYear: entry.releaseYear,
          createdAt: new Date(now + idx * 50).toISOString(),
          isConsolidated: isTargetConsolidated ? true : undefined,
        });
      }
    });
  }

  // 2. Processa redistribuição e conversão multimoeda para CDs dos pacotes absorvidos ou descartados
  const fullyAbsorbedShipmentIds = new Set<string>();
  const partiallyAbsorbedShippingRemaining = new Map<string, number>();
  const survivorAdjustments = new Map<string, SurvivorAdjustment>();

  const targetExchangeRate =
    Number(targetShipmentData.exchangeRate) ||
    CURRENCY_META[targetShipmentData.currency]?.defaultRate ||
    1;

  if (absorbedSet.size > 0 || discardedSet.size > 0) {
    for (const fp of forwarderPackages) {
      if (fp.shipment.id === targetShipmentId) continue;
      const discardedFromSource = fp.items.filter((cd) =>
        discardedSet.has(cd.id)
      );
      const keptInSource = fp.items.filter((cd) => !discardedSet.has(cd.id));
      const movedFromSource = keptInSource.filter((cd) =>
        absorbedSet.has(cd.id)
      );

      if (movedFromSource.length === 0 && discardedFromSource.length === 0) {
        continue;
      }

      const sourceExchangeRate =
        Number(fp.shipment.exchangeRate) ||
        CURRENCY_META[fp.shipment.currency]?.defaultRate ||
        1;
      const conversionFactor =
        fp.shipment.currency === targetShipmentData.currency
          ? 1
          : sourceExchangeRate / targetExchangeRate;

      // Redistribuição de valor pago e frete unitário dos descartados
      const discardedValueSum = discardedFromSource.reduce(
        (acc, cd) => acc + (Number(cd.unitOriginalValue) || 0),
        0
      );
      const discardedUnitShipSum = discardedFromSource.reduce(
        (acc, cd) => acc + getItemUnitInternalShipping(cd, allCdItems),
        0
      );

      const extraUnitVal =
        keptInSource.length > 0 ? discardedValueSum / keptInSource.length : 0;
      const extraUnitShip =
        keptInSource.length > 0
          ? discardedUnitShipSum / keptInSource.length
          : 0;

      for (const keptCd of keptInSource) {
        survivorAdjustments.set(keptCd.id, {
          extraUnitValueInSourceCurr: extraUnitVal,
          extraUnitShipInSourceCurr: extraUnitShip,
          newBundleQuantity:
            discardedFromSource.length > 0 && keptCd.isBundle
              ? keptInSource.length
              : undefined,
          conversionFactorToTarget: conversionFactor,
        });
      }

      if (
        keptInSource.length === 0 ||
        movedFromSource.length >= keptInSource.length
      ) {
        fullyAbsorbedShipmentIds.add(fp.shipment.id);
      } else {
        const remainingRatio =
          (keptInSource.length - movedFromSource.length) / keptInSource.length;
        const remainingInternalShipping = Number(
          (
            (Number(fp.shipment.internalShipping) || 0) * remainingRatio
          ).toFixed(4)
        );
        partiallyAbsorbedShippingRemaining.set(
          fp.shipment.id,
          remainingInternalShipping
        );
      }
    }
  }

  // 3. Atualiza lista de pacotes
  const resolvedShipment: Shipment = {
    ...targetShipmentData,
    id: targetShipmentId,
    createdAt: isExistingShipment
      ? allShipments.find((s) => s.id === targetShipmentId)?.createdAt ||
        new Date(now).toISOString()
      : new Date(now).toISOString(),
    status:
      absorbedSet.size > 0 &&
      (targetShipmentData.status === 'comprado' ||
        targetShipmentData.status === 'no_redirecionador')
        ? 'consolidado'
        : targetShipmentData.status,
    consolidationMode:
      !isTargetConsolidated &&
      (targetShipmentData.status === 'comprado' ||
        targetShipmentData.status === 'no_redirecionador')
        ? 'direct'
        : targetShipmentData.consolidationMode,
  };

  let nextShipments: Shipment[];
  if (isExistingShipment) {
    nextShipments = allShipments.map((s) =>
      s.id === targetShipmentId ? resolvedShipment : s
    );
  } else {
    nextShipments = [resolvedShipment, ...allShipments];
  }

  nextShipments = nextShipments
    .filter((s) => !fullyAbsorbedShipmentIds.has(s.id))
    .map((s) => {
      if (partiallyAbsorbedShippingRemaining.has(s.id)) {
        return {
          ...s,
          internalShipping:
            partiallyAbsorbedShippingRemaining.get(s.id) || 0,
        };
      }
      return s;
    });

  // 4. Atualiza lista de CDs
  const packingHandlingVal = absorbedPayload?.mode === 'unpack_and_repack'
    ? 'unpacked'
    : 'original_box';

  const processedExisting = allCdItems
    .filter((cd) => {
      if (discardedSet.has(cd.id)) return false;
      if (
        isExistingShipment &&
        cd.shipmentId === targetShipmentId &&
        !absorbedSet.has(cd.id) &&
        newCdEntries.length > 0
      ) {
        return updatedEntriesById.has(cd.id);
      }
      return true;
    })
    .map((cd) => {
      const adj = survivorAdjustments.get(cd.id);
      const baseUnitVal =
        (Number(cd.unitOriginalValue) || 0) +
        (adj?.extraUnitValueInSourceCurr || 0);
      const baseUnitShip =
        getItemUnitInternalShipping(cd, allCdItems) +
        (adj?.extraUnitShipInSourceCurr || 0);
      const updatedBundleQty =
        adj?.newBundleQuantity !== undefined
          ? adj.newBundleQuantity
          : cd.bundleTotalQuantity;

      if (absorbedSet.has(cd.id)) {
        const factor = adj?.conversionFactorToTarget ?? 1;
        return {
          ...cd,
          shipmentId: targetShipmentId,
          currency: targetShipmentData.currency,
          isConsolidated: true,
          packingHandling: (packingHandlingVal || cd.packingHandling) as 'original_box' | 'unpacked' | undefined,
          unitOriginalValue: Number((baseUnitVal * factor).toFixed(4)),
          unitInternalShipping: Number((baseUnitShip * factor).toFixed(4)),
          bundleTotalValue:
            cd.bundleTotalValue !== undefined
              ? Number((cd.bundleTotalValue * factor).toFixed(4))
              : undefined,
          bundleInternalShipping:
            cd.bundleInternalShipping !== undefined
              ? Number((cd.bundleInternalShipping * factor).toFixed(4))
              : undefined,
          bundleTotalQuantity: updatedBundleQty,
        };
      }

      if (adj) {
        return {
          ...cd,
          unitOriginalValue: Number(baseUnitVal.toFixed(4)),
          unitInternalShipping: Number(baseUnitShip.toFixed(4)),
          bundleTotalQuantity: updatedBundleQty,
        };
      }

      if (isExistingShipment && updatedEntriesById.has(cd.id)) {
        const edited = updatedEntriesById.get(cd.id)!;
        return {
          ...cd,
          currency: targetShipmentData.currency,
          isConsolidated: isTargetConsolidated,
          artist: edited.artist,
          albumTitle: edited.albumTitle,
          discCount: edited.discCount || cd.discCount || 1,
          unitOriginalValue:
            edited.unitPrice !== undefined
              ? edited.unitPrice
              : cd.unitOriginalValue,
          coverUrl: edited.coverUrl ?? cd.coverUrl,
          releaseYear: edited.releaseYear ?? cd.releaseYear,
          ebayListingUrl: edited.ebayListingUrl ?? cd.ebayListingUrl,
          ebayOrderId: targetShipmentData.ebayOrderId ?? cd.ebayOrderId,
          ebayOrderUrl: targetShipmentData.ebayOrderUrl ?? cd.ebayOrderUrl,
          localTrackingCode:
            initialBundleInfo?.localTrackingCode || cd.localTrackingCode,
        };
      }

      if (isExistingShipment && cd.shipmentId === targetShipmentId) {
        return {
          ...cd,
          isConsolidated: isTargetConsolidated,
        };
      }

      return cd;
    });

  return {
    updatedShipments: nextShipments,
    updatedCdItems: [...processedExisting, ...newlyCreatedCDs],
    newlyCreatedCDs,
    absorbedCount: absorbedSet.size,
    discardedCount: discardedSet.size,
  };
}

/**
 * Desmembra um único CD de um pacote consolidado para um novo pacote avulso ("Comprado").
 */
export function extractCdToSingleShipment(
  item: CDItem,
  parentShipment: Shipment
): { newShipment: Shipment; updatedCd: CDItem } {
  const now = Date.now();
  const newShipmentId = `ship-${now}`;

  const newShipment: Shipment = {
    id: newShipmentId,
    name: generatePackageName([item]),
    shippingDate: parentShipment.shippingDate || '',
    status: 'comprado',
    currency: item.currency || parentShipment.currency,
    exchangeRate: parentShipment.exchangeRate,
    exchangeRateSource: parentShipment.exchangeRateSource,
    consolidationMode: 'direct',
    internalShipping: Number(item.unitInternalShipping) || 0,
    forwarderFee: 0,
    internationalShipping: 0,
    customsTaxBrl: 0,
    isTaxEstimated: false,
    internationalTrackingCode: '',
    notes: `Desmembrado do pacote "${parentShipment.name}"`,
    createdAt: new Date(now).toISOString(),
  };

  const updatedCd: CDItem = {
    ...item,
    shipmentId: newShipmentId,
    isConsolidated: false,
    packingHandling: undefined,
    isBundle: false,
    bundleId: undefined,
    bundleName: undefined,
    bundleTotalValue: undefined,
    bundleTotalQuantity: undefined,
  };

  return { newShipment, updatedCd };
}
