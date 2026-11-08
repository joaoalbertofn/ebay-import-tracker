import { CurrencyCode, Shipment } from '@/types/tracker';

/**
 * Arquitetura extensível de Redirecionadores (Forwarders).
 * Para adicionar um novo redirecionador no futuro (ex: Qwintry, MyVIPBox, Buyee, Mailboxde),
 * basta inserir um novo item em `FORWARDER_CATALOG`.
 */
export interface ForwarderConfig {
  id: string;
  name: string;
  shortLabel: string;
  countryCode: string;
  countryName: string;
  cityLabel: string;
  flag: string;
  currency: CurrencyCode;
  defaultGroupOnlyFee: number;
  defaultUnpackAndRepackFee: number;
  feeSummaryLabel: string;
  badgeClass: string;
  dotClass: string;
  /** Coordenadas geográficas reais no Mapa-Múndi SVG (viewBox 1000 x 540) */
  mapCoordinates: { x: number; y: number };
  /** Posição âncora da pilha de pacotes deste redirecionador */
  stackAnchor: { x: number; y: number };
}

export const FORWARDER_CATALOG: readonly ForwarderConfig[] = [
  {
    id: 'forwardvia',
    name: 'ForwardVia',
    shortLabel: 'ForwardVia (UK)',
    countryCode: 'GB',
    countryName: 'Reino Unido',
    cityLabel: 'Hertfordshire, UK',
    flag: '🇬🇧',
    currency: 'GBP',
    defaultGroupOnlyFee: 2.48,
    defaultUnpackAndRepackFee: 3.6,
    feeSummaryLabel: '£3,60 desemp. • £2,48 agrup.',
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/35',
    dotClass: 'bg-amber-400',
    mapCoordinates: { x: 482, y: 98 },
    stackAnchor: { x: 562, y: 92 },
  },
  {
    id: 'send2hub',
    name: 'Send2Hub',
    shortLabel: 'Send2Hub (UK)',
    countryCode: 'GB',
    countryName: 'Reino Unido',
    cityLabel: 'Londres / Essex, UK',
    flag: '🇬🇧',
    currency: 'GBP',
    defaultGroupOnlyFee: 0,
    defaultUnpackAndRepackFee: 0,
    feeSummaryLabel: 'Consolidação Grátis (£0,00)',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35',
    dotClass: 'bg-emerald-400',
    mapCoordinates: { x: 485, y: 101 },
    stackAnchor: { x: 562, y: 92 },
  },
  {
    id: 'uscloser',
    name: 'UsCloser',
    shortLabel: 'UsCloser (US)',
    countryCode: 'US',
    countryName: 'Estados Unidos',
    cityLabel: 'Orlando / Miami, US',
    flag: '🇺🇸',
    currency: 'USD',
    defaultGroupOnlyFee: 2.0,
    defaultUnpackAndRepackFee: 4.0,
    feeSummaryLabel: 'US$ 4,00 desemp. • US$ 2,00 agrup.',
    badgeClass: 'bg-sky-500/15 text-sky-300 border-sky-500/35',
    dotClass: 'bg-sky-400',
    mapCoordinates: { x: 249, y: 192 },
    stackAnchor: { x: 292, y: 196 },
  },
];

const FORWARDER_BY_ID = new Map<string, ForwarderConfig>(
  FORWARDER_CATALOG.map((f) => [f.id, f])
);

export function getAllForwarders(): readonly ForwarderConfig[] {
  return FORWARDER_CATALOG;
}

export function getForwarderById(
  forwarderId?: string | null
): ForwarderConfig | undefined {
  if (!forwarderId) return undefined;
  return FORWARDER_BY_ID.get(forwarderId.trim().toLowerCase());
}

/**
 * Retorna os redirecionadores compatíveis com a moeda prioritariamente no topo,
 * seguidos pelos demais redirecionadores cadastrados.
 */
export function getForwardersSortedForCurrency(
  currency: CurrencyCode
): ForwarderConfig[] {
  const matching = FORWARDER_CATALOG.filter((f) => f.currency === currency);
  const others = FORWARDER_CATALOG.filter((f) => f.currency !== currency);
  return [...matching, ...others];
}

/**
 * Regra de negócio: Um pacote avulso ('comprado' ou 'no_redirecionador') só pode ser
 * consolidado se tiver um redirecionador selecionado pelo usuário (`forwarderId` preenchido).
 */
export function hasSelectedForwarder(shipment: Pick<Shipment, 'forwarderId'>): boolean {
  return Boolean(shipment.forwarderId && shipment.forwarderId.trim().length > 0);
}

export interface MapWaypoint {
  id: 'origin' | 'forwarder' | 'transit' | 'customs' | 'destination';
  x: number;
  y: number;
  title: string;
  subtitle: string;
  flag: string;
}

export interface PackageMapRoute {
  shipmentId: string;
  originCountryName: string;
  originFlag: string;
  forwarder?: ForwarderConfig;
  waypoints: MapWaypoint[];
  currentWaypointIndex: number;
  currentWaypoint: MapWaypoint;
  stageBadgeLabel: string;
  /** Identificador único da pilha onde este pacote deve ser empilhado */
  stackKey: string;
  /** Título descritivo da pilha */
  stackTitle: string;
  /** Coordenada base da pilha de miniaturas (evita colisão entre pilhas vizinhas) */
  stackAnchor: { x: number; y: number };
}

export const ORIGIN_COUNTRY_MAP_META: Record<
  CurrencyCode,
  {
    countryName: string;
    sellerLocationLabel: string;
    defaultHubLabel: string;
    flag: string;
    sellerCoords: { x: number; y: number };
    sellerStackAnchor: { x: number; y: number };
    defaultHubCoords: { x: number; y: number };
    defaultHubStackAnchor: { x: number; y: number };
    transitCoords: { x: number; y: number };
    transitStackAnchor: { x: number; y: number };
  }
> = {
  GBP: {
    countryName: 'Reino Unido',
    sellerLocationLabel: 'Vendedor eBay (Reino Unido)',
    defaultHubLabel: 'Hub Redirecionador (UK)',
    flag: '🇬🇧',
    sellerCoords: { x: 476, y: 92 },
    sellerStackAnchor: { x: 392, y: 86 },
    defaultHubCoords: { x: 484, y: 100 },
    defaultHubStackAnchor: { x: 562, y: 92 },
    transitCoords: { x: 416, y: 256 },
    transitStackAnchor: { x: 422, y: 254 },
  },
  USD: {
    countryName: 'Estados Unidos',
    sellerLocationLabel: 'Vendedor eBay (EUA)',
    defaultHubLabel: 'Hub Redirecionador (EUA)',
    flag: '🇺🇸',
    sellerCoords: { x: 204, y: 152 },
    sellerStackAnchor: { x: 162, y: 146 },
    defaultHubCoords: { x: 249, y: 192 },
    defaultHubStackAnchor: { x: 292, y: 196 },
    transitCoords: { x: 312, y: 282 },
    transitStackAnchor: { x: 312, y: 282 },
  },
  EUR: {
    countryName: 'Europa (UE)',
    sellerLocationLabel: 'Vendedor eBay (Europa)',
    defaultHubLabel: 'Hub Redirecionador (Europa)',
    flag: '🇪🇺',
    sellerCoords: { x: 514, y: 104 },
    sellerStackAnchor: { x: 645, y: 132 },
    defaultHubCoords: { x: 506, y: 112 },
    defaultHubStackAnchor: { x: 645, y: 132 },
    transitCoords: { x: 432, y: 268 },
    transitStackAnchor: { x: 438, y: 268 },
  },
  JPY: {
    countryName: 'Japão',
    sellerLocationLabel: 'Vendedor (Japão)',
    defaultHubLabel: 'Hub Redirecionador (Tóquio, JP)',
    flag: '🇯🇵',
    sellerCoords: { x: 882, y: 160 },
    sellerStackAnchor: { x: 850, y: 158 },
    defaultHubCoords: { x: 886, y: 164 },
    defaultHubStackAnchor: { x: 850, y: 158 },
    transitCoords: { x: 625, y: 295 },
    transitStackAnchor: { x: 625, y: 295 },
  },
  BRL: {
    countryName: 'Brasil',
    sellerLocationLabel: 'Vendedor Nacional (Brasil)',
    defaultHubLabel: 'Centro de Distribuição (BR)',
    flag: '🇧🇷',
    sellerCoords: { x: 348, y: 372 },
    sellerStackAnchor: { x: 348, y: 372 },
    defaultHubCoords: { x: 352, y: 380 },
    defaultHubStackAnchor: { x: 352, y: 380 },
    transitCoords: { x: 354, y: 388 },
    transitStackAnchor: { x: 354, y: 388 },
  },
};

export const BRAZIL_CUSTOMS_COORDS = {
  x: 341,
  y: 409,
  stackAnchor: { x: 268, y: 404 },
  title: 'Alfândega Receita Federal',
  subtitle: 'Curitiba, PR — Brasil',
  flag: '🇧🇷',
};

export const BRAZIL_DESTINATION_COORDS = {
  x: 357,
  y: 386,
  stackAnchor: { x: 436, y: 386 },
  title: 'Destino Final (Entregue)',
  subtitle: 'Minas Gerais — Brasil',
  flag: '🇧🇷',
};

/**
 * Calcula toda a rota geográfica do pacote no Mapa-Múndi (País de Origem -> Redirecionador -> Oceano -> Curitiba -> MG)
 * e determina em qual ponto e pilha (`stackKey`) o pacote está atualmente.
 */
export function getPackageMapRoute(shipment: Shipment): PackageMapRoute {
  const originMeta =
    ORIGIN_COUNTRY_MAP_META[shipment.currency] || ORIGIN_COUNTRY_MAP_META.GBP;
  const forwarder = getForwarderById(shipment.forwarderId);

  const originWaypoint: MapWaypoint = {
    id: 'origin',
    x: originMeta.sellerCoords.x,
    y: originMeta.sellerCoords.y,
    title: originMeta.countryName,
    subtitle: originMeta.sellerLocationLabel,
    flag: originMeta.flag,
  };

  const forwarderWaypoint: MapWaypoint = {
    id: 'forwarder',
    x: forwarder ? forwarder.mapCoordinates.x : originMeta.defaultHubCoords.x,
    y: forwarder ? forwarder.mapCoordinates.y : originMeta.defaultHubCoords.y,
    title: forwarder ? `${forwarder.name} (${forwarder.countryCode})` : originMeta.defaultHubLabel,
    subtitle: forwarder ? forwarder.cityLabel : `Armazém no ${originMeta.countryName}`,
    flag: forwarder ? forwarder.flag : originMeta.flag,
  };

  // Ponto médio sobre o Oceano Atlântico calculado entre o Hub do Redirecionador e Curitiba/Brasil
  const transitX = Math.round(
    (forwarderWaypoint.x * 0.5 + BRAZIL_CUSTOMS_COORDS.x * 0.5 + originMeta.transitCoords.x) / 2
  );
  const transitY = Math.round(
    (forwarderWaypoint.y * 0.45 + BRAZIL_CUSTOMS_COORDS.y * 0.55 + originMeta.transitCoords.y) / 2
  );

  const transitWaypoint: MapWaypoint = {
    id: 'transit',
    x: transitX,
    y: transitY,
    title: 'Em Trânsito Internacional',
    subtitle: `Rota Aérea ${forwarder ? forwarder.name : originMeta.countryName} → Brasil`,
    flag: '✈️',
  };

  const customsWaypoint: MapWaypoint = {
    id: 'customs',
    x: BRAZIL_CUSTOMS_COORDS.x,
    y: BRAZIL_CUSTOMS_COORDS.y,
    title: BRAZIL_CUSTOMS_COORDS.title,
    subtitle: BRAZIL_CUSTOMS_COORDS.subtitle,
    flag: BRAZIL_CUSTOMS_COORDS.flag,
  };

  const destinationWaypoint: MapWaypoint = {
    id: 'destination',
    x: BRAZIL_DESTINATION_COORDS.x,
    y: BRAZIL_DESTINATION_COORDS.y,
    title: BRAZIL_DESTINATION_COORDS.title,
    subtitle: BRAZIL_DESTINATION_COORDS.subtitle,
    flag: BRAZIL_DESTINATION_COORDS.flag,
  };

  const waypoints: MapWaypoint[] = [
    originWaypoint,
    forwarderWaypoint,
    transitWaypoint,
    customsWaypoint,
    destinationWaypoint,
  ];

  let currentWaypointIndex = 0;
  let stageBadgeLabel = `No Vendedor (${originMeta.countryName})`;
  let stackKey = `origin_${shipment.currency}`;
  let stackTitle = `${originMeta.flag} Vendedor (${originMeta.countryName})`;
  let stackAnchor = originMeta.sellerStackAnchor;

  switch (shipment.status) {
    case 'comprado':
      currentWaypointIndex = 0;
      stageBadgeLabel = forwarder
        ? `${originMeta.countryName} → rumo à ${forwarder.name}`
        : `No Vendedor (${originMeta.countryName})`;
      stackKey = `origin_${shipment.currency}`;
      stackTitle = `${originMeta.flag} Comprado (${originMeta.countryName})`;
      stackAnchor = originMeta.sellerStackAnchor;
      break;
    case 'no_redirecionador':
    case 'consolidado':
      currentWaypointIndex = 1;
      stageBadgeLabel = forwarder
        ? shipment.status === 'consolidado'
          ? `Consolidado na ${forwarder.name}`
          : `No Redirecionador: ${forwarder.name}`
        : `Redirecionador (${originMeta.countryName})`;
      stackKey = `forwarder_${shipment.currency}`;
      stackTitle = forwarder
        ? `${forwarder.flag} Hub ${forwarder.name}`
        : `${originMeta.flag} Redirecionador (${originMeta.countryName})`;
      stackAnchor = forwarder
        ? forwarder.stackAnchor
        : originMeta.defaultHubStackAnchor;
      break;
    case 'em_transito':
      currentWaypointIndex = 2;
      stageBadgeLabel = forwarder
        ? `Em Trânsito (${forwarder.name} → Brasil)`
        : `Em Trânsito (${originMeta.countryName} → Brasil)`;
      stackKey = `transit_${shipment.currency}`;
      stackTitle = `✈️ Em Trânsito (${originMeta.countryName} → BR)`;
      stackAnchor = originMeta.transitStackAnchor;
      break;
    case 'tributado':
      currentWaypointIndex = 3;
      stageBadgeLabel = 'Alfândega Curitiba / Receita';
      stackKey = 'customs_BR';
      stackTitle = '🇧🇷 Alfândega (Curitiba, PR)';
      stackAnchor = BRAZIL_CUSTOMS_COORDS.stackAnchor;
      break;
    case 'entregue':
      currentWaypointIndex = 4;
      stageBadgeLabel = 'Entregue em Minas Gerais, BR';
      stackKey = 'destination_BR';
      stackTitle = '🇧🇷 Entregues (Minas Gerais)';
      stackAnchor = BRAZIL_DESTINATION_COORDS.stackAnchor;
      break;
  }

  return {
    shipmentId: shipment.id,
    originCountryName: originMeta.countryName,
    originFlag: originMeta.flag,
    forwarder,
    waypoints,
    currentWaypointIndex,
    currentWaypoint: waypoints[currentWaypointIndex],
    stageBadgeLabel,
    stackKey,
    stackTitle,
    stackAnchor,
  };
}
