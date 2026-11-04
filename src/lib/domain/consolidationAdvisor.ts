import {
  ConsolidationMode,
  CurrencyCode,
  Shipment,
} from '@/types/tracker';
import { CURRENCY_META, MG_TAX_FACTOR } from '@/lib/calculations';
import {
  ForwarderPackageOption,
  calculateConsolidationFee,
  calculateInheritedInternalShipping,
  calculateSelectedForwarderCdsValue,
} from '@/lib/domain/consolidation';

export type WeightTierKg = 0.5 | 1.0 | 1.3 | 1.5 | 2.0;

export const WEIGHT_TIER_OPTIONS: Array<{
  weightKg: WeightTierKg;
  label: string;
  approxCdsLabel: string;
}> = [
  { weightKg: 0.5, label: 'Até 0,5 kg', approxCdsLabel: '~4 CDs' },
  { weightKg: 1.0, label: 'Até 1,0 kg', approxCdsLabel: '~7–8 CDs' },
  { weightKg: 1.3, label: 'Até 1,3 kg', approxCdsLabel: '~9–10 CDs ⭐' },
  { weightKg: 1.5, label: 'Até 1,5 kg', approxCdsLabel: '~11–12 CDs' },
  { weightKg: 2.0, label: 'Até 2,0 kg', approxCdsLabel: '~15 CDs' },
];

export const DEFAULT_ESTIMATED_GRAMS_PER_DISC = 130;

const DEFAULT_INTL_SHIPPING_BY_CURRENCY: Record<
  CurrencyCode,
  Record<WeightTierKg, number>
> = {
  GBP: { 0.5: 29.5, 1.0: 37.0, 1.3: 41.0, 1.5: 44.0, 2.0: 51.0 },
  USD: { 0.5: 34.0, 1.0: 44.0, 1.3: 50.0, 1.5: 54.0, 2.0: 64.0 },
  EUR: { 0.5: 32.0, 1.0: 40.0, 1.3: 45.0, 1.5: 48.0, 2.0: 56.0 },
  JPY: { 0.5: 4200, 1.0: 5600, 1.3: 6400, 1.5: 7000, 2.0: 8400 },
  BRL: { 0.5: 180.0, 1.0: 240.0, 1.3: 280.0, 1.5: 300.0, 2.0: 360.0 },
};

export interface EvaluatedForwarderPackage {
  option: ForwarderPackageOption;
  shipmentId: string;
  name: string;
  status: Shipment['status'];
  cdCount: number;
  physicalDiscCount: number;
  weightKg: number;
  rawRegisteredWeightKg?: number;
  savedPackagingWeightKg: number;
  isWeightEstimated: boolean;
  cdsPerKgDensity: number;
}

export interface ConsolidationSuggestion {
  id: string;
  rank: number;
  badgeLabel: string;
  packages: EvaluatedForwarderPackage[];
  packageIds: string[];
  cdIds: string[];
  packageCount: number;
  totalCds: number;
  totalPhysicalDiscs: number;
  totalWeightKg: number;
  totalSavedPackagingWeightKg: number;
  hasEstimatedWeights: boolean;
  weightUtilizationPercent: number;
  remainingWeightKg: number;
  exceedsTargetWeight: boolean;
  mode: Exclude<ConsolidationMode, 'direct'>;
  currency: CurrencyCode;
  exchangeRate: number;
  // Valores na moeda original
  cdsValueOriginal: number;
  inheritedInternalShippingOriginal: number;
  forwarderFeeOriginal: number;
  estimatedIntlShippingOriginal: number;
  totalIndirectOriginal: number;
  consolidationAndIntlPerCdOriginal: number;
  indirectRateioPerCdOriginal: number;
  // Valores em BRL
  cdsValueBrl: number;
  totalIndirectBrl: number;
  consolidationAndIntlPerCdBrl: number;
  indirectRateioPerCdBrl: number;
  estimatedTotalNoTaxBrl: number;
  estimatedAvgFinalPerCdBrl: number;
  estimatedTaxMgBrl: number;
  estimatedAvgFinalWithTaxMgPerCdBrl: number;
  estimatedSavingsVsIndividualBrl: number;
}

export interface ConsolidationAdvisorOptions {
  targetMaxWeightKg?: number;
  includePurchasedInTransit?: boolean;
  mode?: Exclude<ConsolidationMode, 'direct'>;
  currency?: CurrencyCode;
  exchangeRate?: number;
  groupOnlyFeeUnit?: number;
  unpackAndRepackFeeUnit?: number;
  estimatedIntlShippingOverride?: number;
  estimatedGramsPerDisc?: number;
  maxResults?: number;
  historicalShipments?: Shipment[];
}

export interface ConsolidationAdvisorReport {
  targetMaxWeightKg: number;
  estimatedIntlShippingOriginal: number;
  eligiblePool: EvaluatedForwarderPackage[];
  inForwarderCount: number;
  inForwarderCds: number;
  inForwarderWeightKg: number;
  purchasedInTransitCount: number;
  purchasedInTransitCds: number;
  purchasedInTransitWeightKg: number;
  remainingCapacityInForwarderKg: number;
  approxRemainingCdsCapacity: number;
  suggestions: ConsolidationSuggestion[];
}

/**
 * Estima o frete internacional para uma faixa de peso (`targetMaxWeightKg`),
 * aproveitando o histórico real de pacotes consolidados/enviados da mesma moeda quando disponível.
 */
export function getEstimatedIntlShippingForWeight(
  targetWeightKg: number,
  currency: CurrencyCode,
  historicalShipments: Shipment[] = []
): number {
  const closestTier: WeightTierKg =
    targetWeightKg <= 0.55
      ? 0.5
      : targetWeightKg <= 1.05
      ? 1.0
      : targetWeightKg <= 1.35
      ? 1.3
      : targetWeightKg <= 1.65
      ? 1.5
      : 2.0;

  // Busca pacotes históricos da mesma moeda com frete internacional e peso próximos da faixa
  const matchingHistory = historicalShipments.filter(
    (s) =>
      s.currency === currency &&
      Number(s.internationalShipping) > 0 &&
      Number(s.weightKg) > 0 &&
      Math.abs(Number(s.weightKg) - closestTier) <= 0.2
  );

  if (matchingHistory.length > 0) {
    const avg =
      matchingHistory.reduce(
        (acc, s) => acc + Number(s.internationalShipping),
        0
      ) / matchingHistory.length;
    return Number(avg.toFixed(2));
  }

  return (
    DEFAULT_INTL_SHIPPING_BY_CURRENCY[currency]?.[closestTier] ??
    DEFAULT_INTL_SHIPPING_BY_CURRENCY.GBP[closestTier]
  );
}

/**
 * Resolve o peso de um pacote elegível:
 * - No modo `unpack_and_repack` (Desempacotar): desconta o excesso da embalagem externa do vendedor,
 *   aplicando a média de `estimatedGramsPerDisc` (padrão 120g/CD) quando o peso bruto cadastrado é maior.
 * - No modo `group_only` (Só Agrupar): mantém o peso bruto cadastrado do pacote original.
 */
export function evaluateForwarderPackage(
  option: ForwarderPackageOption,
  estimatedGramsPerDisc: number = DEFAULT_ESTIMATED_GRAMS_PER_DISC,
  mode: Exclude<ConsolidationMode, 'direct'> = 'unpack_and_repack'
): EvaluatedForwarderPackage {
  const cdCount = option.items.length;
  const physicalDiscCount = option.items.reduce(
    (acc, item) => acc + Math.max(1, Number(item.discCount) || 1),
    0
  );

  const rawWeight = Number(option.shipment.weightKg);
  const hasRealWeight = Number.isFinite(rawWeight) && rawWeight > 0;
  const rawRegisteredWeightKg = hasRealWeight
    ? Number(rawWeight.toFixed(2))
    : undefined;

  const unpackedEstimateKg = Number(
    Math.max(0.1, (cdCount * estimatedGramsPerDisc) / 1000).toFixed(2)
  );

  let weightKg: number;
  let savedPackagingWeightKg = 0;
  let isWeightEstimated = !hasRealWeight;

  if (!hasRealWeight) {
    weightKg = unpackedEstimateKg;
  } else if (
    mode === 'unpack_and_repack' &&
    rawRegisteredWeightKg! > unpackedEstimateKg
  ) {
    weightKg = unpackedEstimateKg;
    savedPackagingWeightKg = Number(
      (rawRegisteredWeightKg! - unpackedEstimateKg).toFixed(2)
    );
    isWeightEstimated = true;
  } else {
    weightKg = rawRegisteredWeightKg!;
  }

  const cdsPerKgDensity = weightKg > 0 ? cdCount / weightKg : cdCount;

  return {
    option,
    shipmentId: option.shipment.id,
    name: option.shipment.name,
    status: option.shipment.status,
    cdCount,
    physicalDiscCount,
    weightKg,
    rawRegisteredWeightKg,
    savedPackagingWeightKg,
    isWeightEstimated,
    cdsPerKgDensity,
  };
}

/**
 * Gera recomendações inteligentes de pacotes para consolidar, otimizando:
 * 1. Menor rateio de custos indiretos por CD (diluição da taxa por pacote + frete internacional pelo nº de CDs)
 * 2. Aproveitamento eficiente da faixa de peso alvo (ex: até 1,2 kg para ~10 CDs sem estourar)
 */
export function generateConsolidationAdvisorReport(
  forwarderPackages: ForwarderPackageOption[],
  options: ConsolidationAdvisorOptions = {}
): ConsolidationAdvisorReport {
  const targetMaxWeightKg = options.targetMaxWeightKg ?? 1.3;
  const includePurchasedInTransit = options.includePurchasedInTransit ?? false;
  const mode = options.mode ?? 'unpack_and_repack';
  const currency = options.currency ?? 'GBP';
  const exchangeRate =
    options.exchangeRate && options.exchangeRate > 0
      ? options.exchangeRate
      : CURRENCY_META[currency]?.defaultRate || 1;
  const groupOnlyFeeUnit =
    options.groupOnlyFeeUnit ?? CURRENCY_META[currency].defaultGroupOnlyFee;
  const unpackAndRepackFeeUnit =
    options.unpackAndRepackFeeUnit ??
    CURRENCY_META[currency].defaultUnpackAndRepackFee;
  const estimatedGramsPerDisc =
    options.estimatedGramsPerDisc ?? DEFAULT_ESTIMATED_GRAMS_PER_DISC;
  const maxResults = options.maxResults ?? 3;

  const allEvaluated = forwarderPackages
    .filter((fp) => fp.items.length > 0)
    .map((fp) => evaluateForwarderPackage(fp, estimatedGramsPerDisc, mode));

  const inForwarderPackages = allEvaluated.filter(
    (p) => p.status === 'no_redirecionador'
  );
  const purchasedPackages = allEvaluated.filter((p) => p.status === 'comprado');

  const inForwarderCds = inForwarderPackages.reduce(
    (acc, p) => acc + p.cdCount,
    0
  );
  const inForwarderWeightKg = Number(
    inForwarderPackages.reduce((acc, p) => acc + p.weightKg, 0).toFixed(2)
  );

  const purchasedInTransitCds = purchasedPackages.reduce(
    (acc, p) => acc + p.cdCount,
    0
  );
  const purchasedInTransitWeightKg = Number(
    purchasedPackages.reduce((acc, p) => acc + p.weightKg, 0).toFixed(2)
  );

  const remainingCapacityInForwarderKg = Number(
    Math.max(0, targetMaxWeightKg - inForwarderWeightKg).toFixed(2)
  );
  const approxRemainingCdsCapacity = Math.max(
    0,
    Math.floor((remainingCapacityInForwarderKg * 1000) / estimatedGramsPerDisc)
  );

  const eligiblePool = includePurchasedInTransit
    ? allEvaluated
    : inForwarderPackages;

  const estimatedIntlShippingOriginal =
    options.estimatedIntlShippingOverride !== undefined &&
    options.estimatedIntlShippingOverride >= 0
      ? options.estimatedIntlShippingOverride
      : getEstimatedIntlShippingForWeight(
          targetMaxWeightKg,
          currency,
          options.historicalShipments
        );

  if (eligiblePool.length < 2) {
    return {
      targetMaxWeightKg,
      estimatedIntlShippingOriginal,
      eligiblePool,
      inForwarderCount: inForwarderPackages.length,
      inForwarderCds,
      inForwarderWeightKg,
      purchasedInTransitCount: purchasedPackages.length,
      purchasedInTransitCds,
      purchasedInTransitWeightKg,
      remainingCapacityInForwarderKg,
      approxRemainingCdsCapacity,
      suggestions: [],
    };
  }

  // Para manter busca de subconjuntos instantânea (< 2ms), limitamos o pool combinatório aos 14 melhores pacotes por densidade de CDs
  const candidatePool =
    eligiblePool.length > 14
      ? [...eligiblePool]
          .sort(
            (a, b) =>
              b.cdsPerKgDensity - a.cdsPerKgDensity || b.cdCount - a.cdCount
          )
          .slice(0, 14)
      : eligiblePool;

  const singlePkgIntlShippingRef = getEstimatedIntlShippingForWeight(
    0.5,
    currency,
    options.historicalShipments
  );

  const buildSuggestionFromSubset = (
    subset: EvaluatedForwarderPackage[]
  ): Omit<ConsolidationSuggestion, 'rank' | 'badgeLabel'> => {
    const packageCount = subset.length;
    const totalCds = subset.reduce((acc, p) => acc + p.cdCount, 0);
    const totalPhysicalDiscs = subset.reduce(
      (acc, p) => acc + p.physicalDiscCount,
      0
    );
    const totalWeightKg = Number(
      subset.reduce((acc, p) => acc + p.weightKg, 0).toFixed(2)
    );
    const totalSavedPackagingWeightKg = Number(
      subset
        .reduce((acc, p) => acc + (p.savedPackagingWeightKg || 0), 0)
        .toFixed(2)
    );
    const hasEstimatedWeights = subset.some((p) => p.isWeightEstimated);
    const exceedsTargetWeight = totalWeightKg > targetMaxWeightKg + 0.0001;
    const weightUtilizationPercent = Math.min(
      100,
      Math.round((totalWeightKg / Math.max(0.1, targetMaxWeightKg)) * 100)
    );
    const remainingWeightKg = Number(
      Math.max(0, targetMaxWeightKg - totalWeightKg).toFixed(2)
    );

    const packageIds = subset.map((p) => p.shipmentId);
    const cdIds = subset.flatMap((p) => p.option.items.map((cd) => cd.id));
    const selectedCdIdsSet = new Set(cdIds);
    const emptyDiscardedSet = new Set<string>();
    const subsetOptions = subset.map((p) => p.option);

    const inheritedInternalShippingOriginal =
      calculateInheritedInternalShipping(
        subsetOptions,
        selectedCdIdsSet,
        emptyDiscardedSet,
        currency,
        exchangeRate
      );

    const cdsValueOriginal = calculateSelectedForwarderCdsValue(
      subsetOptions,
      selectedCdIdsSet,
      emptyDiscardedSet,
      currency,
      exchangeRate
    );

    const forwarderFeeOriginal = calculateConsolidationFee(
      packageCount,
      mode,
      groupOnlyFeeUnit,
      unpackAndRepackFeeUnit
    );

    // Se exceder a faixa alvo (fallback), estima o frete da faixa real do subconjunto
    const effectiveIntlShippingOriginal = exceedsTargetWeight
      ? getEstimatedIntlShippingForWeight(
          totalWeightKg,
          currency,
          options.historicalShipments
        )
      : estimatedIntlShippingOriginal;

    const totalIndirectOriginal = Number(
      (
        inheritedInternalShippingOriginal +
        forwarderFeeOriginal +
        effectiveIntlShippingOriginal
      ).toFixed(2)
    );

    const consolidationAndIntlOriginal =
      forwarderFeeOriginal + effectiveIntlShippingOriginal;
    const consolidationAndIntlPerCdOriginal = Number(
      (consolidationAndIntlOriginal / totalCds).toFixed(2)
    );
    const indirectRateioPerCdOriginal = Number(
      (totalIndirectOriginal / totalCds).toFixed(2)
    );

    const cdsValueBrl = Number((cdsValueOriginal * exchangeRate).toFixed(2));
    const totalIndirectBrl = Number(
      (totalIndirectOriginal * exchangeRate).toFixed(2)
    );
    const consolidationAndIntlPerCdBrl = Number(
      (consolidationAndIntlPerCdOriginal * exchangeRate).toFixed(2)
    );
    const indirectRateioPerCdBrl = Number(
      (totalIndirectBrl / totalCds).toFixed(2)
    );

    const estimatedTotalNoTaxBrl = Number(
      (cdsValueBrl + totalIndirectBrl).toFixed(2)
    );
    const estimatedAvgFinalPerCdBrl = Number(
      (estimatedTotalNoTaxBrl / totalCds).toFixed(2)
    );
    const estimatedTaxMgBrl = Number((cdsValueBrl * MG_TAX_FACTOR).toFixed(2));
    const estimatedAvgFinalWithTaxMgPerCdBrl = Number(
      ((estimatedTotalNoTaxBrl + estimatedTaxMgBrl) / totalCds).toFixed(2)
    );

    // Economia vs enviar cada pacote separadamente sem consolidar
    const separateIntlShippingTotalOriginal =
      packageCount * singlePkgIntlShippingRef;
    const savingsOriginal = Math.max(
      0,
      separateIntlShippingTotalOriginal -
        (forwarderFeeOriginal + effectiveIntlShippingOriginal)
    );
    const estimatedSavingsVsIndividualBrl = Number(
      (savingsOriginal * exchangeRate).toFixed(2)
    );

    return {
      id: packageIds.slice().sort().join('+'),
      packages: subset,
      packageIds,
      cdIds,
      packageCount,
      totalCds,
      totalPhysicalDiscs,
      totalWeightKg,
      totalSavedPackagingWeightKg,
      hasEstimatedWeights,
      weightUtilizationPercent,
      remainingWeightKg,
      exceedsTargetWeight,
      mode,
      currency,
      exchangeRate,
      cdsValueOriginal,
      inheritedInternalShippingOriginal,
      forwarderFeeOriginal,
      estimatedIntlShippingOriginal: effectiveIntlShippingOriginal,
      totalIndirectOriginal,
      consolidationAndIntlPerCdOriginal,
      indirectRateioPerCdOriginal,
      cdsValueBrl,
      totalIndirectBrl,
      consolidationAndIntlPerCdBrl,
      indirectRateioPerCdBrl,
      estimatedTotalNoTaxBrl,
      estimatedAvgFinalPerCdBrl,
      estimatedTaxMgBrl,
      estimatedAvgFinalWithTaxMgPerCdBrl,
      estimatedSavingsVsIndividualBrl,
    };
  };

  const validWithinWeight: Array<
    Omit<ConsolidationSuggestion, 'rank' | 'badgeLabel'>
  > = [];
  const overWeightFallbacks: Array<
    Omit<ConsolidationSuggestion, 'rank' | 'badgeLabel'>
  > = [];

  const n = candidatePool.length;
  const totalMasks = 1 << n;

  for (let mask = 1; mask < totalMasks; mask++) {
    // Conta bits (mínimo 2 pacotes para consolidar)
    let bitCount = 0;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) bitCount++;
    }
    if (bitCount < 2) continue;

    const subset: EvaluatedForwarderPackage[] = [];
    let weightSum = 0;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        subset.push(candidatePool[i]);
        weightSum += candidatePool[i].weightKg;
      }
    }

    if (weightSum <= targetMaxWeightKg + 0.0001) {
      validWithinWeight.push(buildSuggestionFromSubset(subset));
    } else if (bitCount === 2) {
      overWeightFallbacks.push(buildSuggestionFromSubset(subset));
    }
  }

  // Ordenação principal:
  // 1. Menor custo de consolidação + frete internacional por CD (diluição da caixa/redirecionador)
  // 2. Menor rateio indireto total por CD em BRL (Regra 2)
  // 3. Maior quantidade de CDs na caixa
  // 4. Melhor aproveitamento do peso (mais próximo de targetMaxWeightKg)
  const sortSuggestions = (
    a: Omit<ConsolidationSuggestion, 'rank' | 'badgeLabel'>,
    b: Omit<ConsolidationSuggestion, 'rank' | 'badgeLabel'>
  ) => {
    if (
      Math.abs(
        a.consolidationAndIntlPerCdBrl - b.consolidationAndIntlPerCdBrl
      ) > 0.05
    ) {
      return a.consolidationAndIntlPerCdBrl - b.consolidationAndIntlPerCdBrl;
    }
    if (Math.abs(a.indirectRateioPerCdBrl - b.indirectRateioPerCdBrl) > 0.05) {
      return a.indirectRateioPerCdBrl - b.indirectRateioPerCdBrl;
    }
    if (b.totalCds !== a.totalCds) {
      return b.totalCds - a.totalCds;
    }
    return b.totalWeightKg - a.totalWeightKg;
  };

  if (validWithinWeight.length === 0) {
    overWeightFallbacks.sort(
      (a, b) => a.totalWeightKg - b.totalWeightKg || sortSuggestions(a, b)
    );
    const fallbackTop = overWeightFallbacks
      .slice(0, maxResults)
      .map((item, idx) => ({
        ...item,
        rank: idx + 1,
        badgeLabel:
          idx === 0
            ? 'Menor Peso Disponível (Acima da Meta)'
            : `Alternativa #${idx + 1}`,
      }));

    return {
      targetMaxWeightKg,
      estimatedIntlShippingOriginal,
      eligiblePool,
      inForwarderCount: inForwarderPackages.length,
      inForwarderCds,
      inForwarderWeightKg,
      purchasedInTransitCount: purchasedPackages.length,
      purchasedInTransitCds,
      purchasedInTransitWeightKg,
      remainingCapacityInForwarderKg,
      approxRemainingCdsCapacity,
      suggestions: fallbackTop,
    };
  }

  validWithinWeight.sort(sortSuggestions);

  // Filtra combinações estritamente dominadas (subconjuntos que têm rateio pior que uma combinação maior que também cabe na mesma caixa)
  const nonDominated = validWithinWeight.filter((candidate) => {
    return !validWithinWeight.some((other) => {
      if (other.id === candidate.id) return false;
      if (other.packageCount <= candidate.packageCount) return false;
      const isSubset = candidate.packageIds.every((id) =>
        other.packageIds.includes(id)
      );
      if (!isSubset) return false;
      return (
        other.consolidationAndIntlPerCdBrl <=
          candidate.consolidationAndIntlPerCdBrl &&
        other.indirectRateioPerCdBrl <= candidate.indirectRateioPerCdBrl
      );
    });
  });

  const selectedList: Array<
    Omit<ConsolidationSuggestion, 'rank' | 'badgeLabel'>
  > = [];
  const usedIds = new Set<string>();

  for (const item of nonDominated) {
    if (selectedList.length >= maxResults) break;
    selectedList.push(item);
    usedIds.add(item.id);
  }

  // Se houver menos que maxResults não-dominadas, completa com as próximas melhores combinações
  if (selectedList.length < maxResults) {
    for (const item of validWithinWeight) {
      if (selectedList.length >= maxResults) break;
      if (!usedIds.has(item.id)) {
        selectedList.push(item);
        usedIds.add(item.id);
      }
    }
  }

  const maxCdsInSelected = Math.max(...selectedList.map((s) => s.totalCds), 0);

  const suggestions: ConsolidationSuggestion[] = selectedList.map(
    (item, idx) => {
      let badgeLabel = `Opção #${idx + 1}`;
      if (idx === 0) {
        badgeLabel = '🏆 Melhor Rateio por CD';
      } else if (
        item.totalCds === maxCdsInSelected &&
        item.totalCds > selectedList[0].totalCds
      ) {
        badgeLabel = '📦 Mais CDs na Caixa';
      } else if (item.packageCount < selectedList[0].packageCount) {
        badgeLabel = '⚡ Menos Pacotes (Taxa Menor)';
      } else {
        badgeLabel = `✨ Alternativa #${idx + 1}`;
      }

      return {
        ...item,
        rank: idx + 1,
        badgeLabel,
      };
    }
  );

  return {
    targetMaxWeightKg,
    estimatedIntlShippingOriginal,
    eligiblePool,
    inForwarderCount: inForwarderPackages.length,
    inForwarderCds,
    inForwarderWeightKg,
    purchasedInTransitCount: purchasedPackages.length,
    purchasedInTransitCds,
    purchasedInTransitWeightKg,
    remainingCapacityInForwarderKg,
    approxRemainingCdsCapacity,
    suggestions,
  };
}
