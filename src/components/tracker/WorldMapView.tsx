'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Globe,
  List,
  Plane,
  MapPin,
  Disc3,
  Layers,
  X,
  Building2,
  Navigation,
} from 'lucide-react';
import {
  Shipment,
  ShipmentStatus,
  ShipmentSummary,
} from '@/types/tracker';
import { STATUS_LABELS } from '@/components/ShipmentModal';
import { AlbumCover } from '@/components/AlbumCover';
import {
  formatBrl,
  formatMediaCountLabel,
} from '@/lib/formatters';
import {
  BRAZIL_CUSTOMS_COORDS,
  BRAZIL_DESTINATION_COORDS,
  FORWARDER_CATALOG,
  PackageMapRoute,
  getPackageMapRoute,
} from '@/lib/domain/forwarders';
import { WORLD_MAP_PATHS } from '@/components/tracker/WorldMapSvgPaths';

interface WorldMapViewProps {
  shipments: Shipment[];
  summariesMap: Map<string, ShipmentSummary>;
  selectedShipmentId: string | null;
  onSelectShipmentFromMap: (shipmentId: string) => void;
  onSwitchToListView: () => void;
  renderSelectedPackageDetail?: () => React.ReactNode;
}

interface StackedCardNode {
  shipment: Shipment;
  summary?: ShipmentSummary;
  route: PackageMapRoute;
  stackIndex: number;
  stackCount: number;
  pinX: number;
  pinY: number;
  cardX: number;
  cardY: number;
}

interface StackClusterGroup {
  stackKey: string;
  stackTitle: string;
  pinX: number;
  pinY: number;
  baseX: number;
  baseY: number;
  cards: StackedCardNode[];
}

/**
 * Gera um caminho SVG curvo suave (Quadratic Bezier) entre dois pontos (x1, y1) e (x2, y2).
 */
function buildCurvedSvgPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): string {
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  const arcLift = Math.min(46, dist * 0.17);
  const cx = midX - (dy / (dist || 1)) * arcLift * 0.35;
  const cy = midY - arcLift;
  return `M ${x1} ${y1} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x2} ${y2}`;
}

export const WorldMapView: React.FC<WorldMapViewProps> = ({
  shipments,
  summariesMap,
  onSelectShipmentFromMap,
  onSwitchToListView,
  renderSelectedPackageDetail,
}) => {
  const [mapStatusFilter, setMapStatusFilter] = useState<
    ShipmentStatus | 'ALL' | 'ACTIVE_ONLY'
  >('ALL');
  const [mapForwarderFilter, setMapForwarderFilter] = useState<string>('ALL');
  const [hoveredShipmentId, setHoveredShipmentId] = useState<string | null>(
    null
  );
  const [modalShipmentId, setModalShipmentId] = useState<string | null>(null);

  // Fecha o modal de detalhes ao pressionar ESC
  useEffect(() => {
    if (!modalShipmentId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setModalShipmentId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [modalShipmentId]);

  const visibleShipments = useMemo(() => {
    return shipments.filter((s) => {
      if (mapStatusFilter === 'ACTIVE_ONLY' && s.status === 'entregue') {
        return false;
      }
      if (
        mapStatusFilter !== 'ALL' &&
        mapStatusFilter !== 'ACTIVE_ONLY' &&
        s.status !== mapStatusFilter
      ) {
        return false;
      }
      if (mapForwarderFilter !== 'ALL') {
        if (mapForwarderFilter === 'NONE') {
          if (s.forwarderId) return false;
        } else if (s.forwarderId !== mapForwarderFilter) {
          return false;
        }
      }
      return true;
    });
  }, [shipments, mapStatusFilter, mapForwarderFilter]);

  // Agrupa pacotes por ponto geográfico/etapa (stackKey) e organiza cada pilha um atrás do outro (efeito baralho em cascata)
  const stackClusters = useMemo<StackClusterGroup[]>(() => {
    const groups = new Map<
      string,
      Array<{
        shipment: Shipment;
        summary?: ShipmentSummary;
        route: PackageMapRoute;
      }>
    >();

    for (const shipment of visibleShipments) {
      const route = getPackageMapRoute(shipment);
      const summary = summariesMap.get(shipment.id);
      const list = groups.get(route.stackKey) || [];
      list.push({ shipment, summary, route });
      groups.set(route.stackKey, list);
    }

    const clusters: StackClusterGroup[] = [];

    groups.forEach((items, stackKey) => {
      const firstRoute = items[0].route;
      const count = items.length;
      const pinX = firstRoute.currentWaypoint.x;
      const pinY = firstRoute.currentWaypoint.y;
      const baseX = firstRoute.stackAnchor.x;
      const baseY = firstRoute.stackAnchor.y;

      // Passo vertical compacto para que o nome, qtd de CDs e preço de cada pacote de trás apareçam claramente embaixo da carta da frente
      const stepY = count <= 3 ? 34 : count <= 5 ? 28 : count <= 8 ? 23 : 19;
      const stepX = -3.5;

      const cards: StackedCardNode[] = items.map((item, idx) => {
        const rawX = baseX + idx * stepX;
        const rawY = baseY + idx * stepY;

        const cardX = Math.max(82, Math.min(918, rawX));
        const cardY = Math.max(46, Math.min(492, rawY));

        return {
          shipment: item.shipment,
          summary: item.summary,
          route: item.route,
          stackIndex: idx,
          stackCount: count,
          pinX,
          pinY,
          cardX,
          cardY,
        };
      });

      clusters.push({
        stackKey,
        stackTitle: firstRoute.stackTitle,
        pinX,
        pinY,
        baseX: cards[0].cardX,
        baseY: cards[0].cardY,
        cards,
      });
    });

    return clusters;
  }, [visibleShipments, summariesMap]);

  // Pacote cuja rota está ativa no mapa (apenas quando sob o mouse ou aberto no modal, conforme definido para manter o mapa limpo)
  const highlightedRouteNode = useMemo<StackedCardNode | null>(() => {
    const targetId = hoveredShipmentId || modalShipmentId;
    if (!targetId) return null;
    for (const cluster of stackClusters) {
      const found = cluster.cards.find((c) => c.shipment.id === targetId);
      if (found) return found;
    }
    return null;
  }, [hoveredShipmentId, modalShipmentId, stackClusters]);

  // Estatísticas rápidas por etapa geográfica
  const stageStats = useMemo(() => {
    let inOrigin = 0;
    let inForwarder = 0;
    let inTransit = 0;
    let inBrazilCustoms = 0;
    let delivered = 0;

    for (const s of shipments) {
      if (s.status === 'comprado') inOrigin++;
      else if (s.status === 'no_redirecionador' || s.status === 'consolidado')
        inForwarder++;
      else if (s.status === 'em_transito') inTransit++;
      else if (s.status === 'tributado') inBrazilCustoms++;
      else if (s.status === 'entregue') delivered++;
    }

    return { inOrigin, inForwarder, inTransit, inBrazilCustoms, delivered };
  }, [shipments]);

  const handleClickMiniature = (shipmentId: string) => {
    setHoveredShipmentId(null);
    onSelectShipmentFromMap(shipmentId);
    setModalShipmentId(shipmentId);
  };

  return (
    <section className="lg:col-span-12 space-y-4">
      {/* BARRA DE CONTROLE DO MAPA-MÚNDI */}
      <div className="rounded-2xl bg-slate-900/75 border border-slate-800/90 p-3.5 sm:p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {/* Toggle Lista vs Mapa-Múndi */}
            <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-950 border border-slate-800">
              <button
                type="button"
                onClick={onSwitchToListView}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-white transition cursor-pointer"
              >
                <List className="w-3.5 h-3.5" />
                <span>Lista ({shipments.length})</span>
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white shadow-sm shadow-indigo-500/30 cursor-pointer"
              >
                <Globe className="w-3.5 h-3.5" />
                <span>Mapa-Múndi ({visibleShipments.length})</span>
              </button>
            </div>

            <div>
              <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                <span>Onde está cada Pacote</span>
                <span className="text-[11px] font-normal text-slate-400 hidden sm:inline">
                  • Passe o mouse na pilha para destacar a rota ou clique no pacote para abrir seus detalhes
                </span>
              </h2>
            </div>
          </div>

          {/* Resumo de Pacotes por Etapa da Rota */}
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-purple-500/10 border border-purple-500/30 px-2.5 py-1 text-purple-300">
              <span className="w-2 h-2 rounded-full bg-purple-400" />
              Origem/Vendedor: <strong>{stageStats.inOrigin}</strong>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 text-amber-300">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              Redirecionador: <strong>{stageStats.inForwarder}</strong>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500/10 border border-sky-500/30 px-2.5 py-1 text-sky-300">
              <Plane className="w-3 h-3 text-sky-400" />
              Oceano/Trânsito: <strong>{stageStats.inTransit}</strong>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 px-2.5 py-1 text-rose-300">
              <span className="w-2 h-2 rounded-full bg-rose-400" />
              Curitiba/Receita: <strong>{stageStats.inBrazilCustoms}</strong>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 text-emerald-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              Entregues (MG): <strong>{stageStats.delivered}</strong>
            </span>
          </div>
        </div>

        {/* Filtros Rápidos do Mapa (Status + Redirecionador) */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
            <button
              type="button"
              onClick={() => setMapStatusFilter('ALL')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition cursor-pointer shrink-0 ${
                mapStatusFilter === 'ALL'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              Todos ({shipments.length})
            </button>
            <button
              type="button"
              onClick={() => setMapStatusFilter('ACTIVE_ONLY')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition cursor-pointer shrink-0 ${
                mapStatusFilter === 'ACTIVE_ONLY'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              Em Andamento ({shipments.length - stageStats.delivered})
            </button>
            {(Object.keys(STATUS_LABELS) as ShipmentStatus[]).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setMapStatusFilter(st)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition cursor-pointer shrink-0 flex items-center gap-1.5 ${
                  mapStatusFilter === st
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${STATUS_LABELS[st].dotClass}`}
                />
                {STATUS_LABELS[st].shortLabel}
              </button>
            ))}
          </div>

          {/* Filtro por Redirecionador */}
          <div className="flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="text-[11px] text-slate-400">Redirecionador:</span>
            <select
              value={mapForwarderFilter}
              onChange={(e) => setMapForwarderFilter(e.target.value)}
              className="rounded-lg bg-slate-950 border border-slate-800 px-2.5 py-1 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none cursor-pointer"
            >
              <option value="ALL">Todos os Redirecionadores</option>
              {FORWARDER_CATALOG.map((fw) => (
                <option key={fw.id} value={fw.id}>
                  {fw.flag} {fw.name} ({fw.countryCode})
                </option>
              ))}
              <option value="NONE">Sem Redirecionador (No Vendedor)</option>
            </select>
          </div>
        </div>
      </div>

      {/* CONTAINER DO MAPA-MÚNDI INTERATIVO DE ALTA PRECISÃO */}
      <div className="relative isolate z-10 rounded-2xl bg-slate-950 border border-slate-800/90 shadow-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <div className="relative min-w-[980px] w-full aspect-[1000/560] select-none bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#0b1528] via-[#060b16] to-[#030712]">
            {/* CAMADA 1: SVG DO MAPA-MÚNDI FIEL + ROTA DO PACOTE EM DESTAQUE */}
            <svg
              viewBox="0 0 1000 560"
              className="w-full h-full block"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <linearGradient id="routeActiveGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#a855f7" />
                  <stop offset="50%" stopColor="#38bdf8" />
                  <stop offset="100%" stopColor="#10b981" />
                </linearGradient>
                <linearGradient id="continentFill" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#111c30" />
                  <stop offset="100%" stopColor="#0c1424" />
                </linearGradient>
                <linearGradient id="highlightCountryFill" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#1e293b" />
                  <stop offset="100%" stopColor="#172554" />
                </linearGradient>
                <linearGradient id="brazilFill" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#0f292a" />
                  <stop offset="100%" stopColor="#0d1f2d" />
                </linearGradient>
                <filter id="glowRoute" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3.5" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>

              {/* Grade Cartográfica de Latitude/Longitude */}
              <g stroke="#1e293b" strokeWidth="0.55" strokeDasharray="2 4" opacity="0.55">
                {[80, 150, 220, 306, 390, 470].map((y) => (
                  <line key={`lat-${y}`} x1="0" y1={y} x2="1000" y2={y} />
                ))}
                {[120, 240, 360, 480, 600, 720, 840].map((x) => (
                  <line key={`lon-${x}`} x1={x} y1="0" x2={x} y2="560" />
                ))}
              </g>

              {/* Linha do Equador (lat 0° -> y = 306) */}
              <line
                x1="0"
                y1="306"
                x2="1000"
                y2="306"
                stroke="#334155"
                strokeWidth="0.8"
                strokeDasharray="6 4"
                opacity="0.45"
              />

              {/* POLÍGONOS GEOGRÁFICOS FIÉIS DOS CONTINENTES E PAÍSES */}
              <g>
                {WORLD_MAP_PATHS.map((region) => (
                  <path
                    key={region.id}
                    d={region.d}
                    fill={
                      region.isBrazil
                        ? 'url(#brazilFill)'
                        : region.isHighlightCountry
                        ? 'url(#highlightCountryFill)'
                        : 'url(#continentFill)'
                    }
                    stroke={
                      region.isBrazil
                        ? '#10b981'
                        : region.isHighlightCountry
                        ? '#3b82f6'
                        : '#1e293b'
                    }
                    strokeOpacity={
                      region.isBrazil
                        ? 0.45
                        : region.isHighlightCountry
                        ? 0.5
                        : 0.85
                    }
                    strokeWidth={
                      region.isBrazil || region.isHighlightCountry ? 1.15 : 0.9
                    }
                    strokeLinejoin="round"
                  />
                ))}
              </g>

              {/* RÓTULOS CARTÓGRAFICOS DOS OCEANOS E REGIÕES */}
              <g className="pointer-events-none select-none">
                <text
                  x="365"
                  y="245"
                  fill="#1e293b"
                  fontSize="10"
                  fontWeight="700"
                  letterSpacing="3.5"
                  textAnchor="middle"
                >
                  OCEANO ATLÂNTICO
                </text>
                <text
                  x="95"
                  y="315"
                  fill="#1e293b"
                  fontSize="10"
                  fontWeight="700"
                  letterSpacing="3.5"
                  textAnchor="middle"
                >
                  OCEANO PACÍFICO
                </text>
                <text
                  x="685"
                  y="365"
                  fill="#1e293b"
                  fontSize="10"
                  fontWeight="700"
                  letterSpacing="3.5"
                  textAnchor="middle"
                >
                  OCEANO ÍNDICO
                </text>
                <text
                  x="885"
                  y="142"
                  fill="#64748b"
                  fontSize="9.5"
                  fontWeight="700"
                  letterSpacing="1"
                  textAnchor="middle"
                >
                  🇯🇵 JAPÃO
                </text>
              </g>

              {/* CONECTORES SUTIS DE CADA PILHA ATÉ SEU PINO GEOGRÁFICO REAL */}
              {stackClusters.map((cluster) => (
                <g key={`pin-cluster-${cluster.stackKey}`}>
                  <line
                    x1={cluster.pinX}
                    y1={cluster.pinY}
                    x2={cluster.baseX}
                    y2={cluster.baseY}
                    stroke="#475569"
                    strokeWidth="1.1"
                    strokeDasharray="2 3"
                    opacity="0.65"
                  />
                  <circle
                    cx={cluster.pinX}
                    cy={cluster.pinY}
                    r="4"
                    fill="#38bdf8"
                    stroke="#020617"
                    strokeWidth="1.5"
                  />
                </g>
              ))}

              {/* ROTA EXCLUSIVA DO PACOTE DESTACADO NO HOVER OU ABERTO NO MODAL */}
              {highlightedRouteNode && (() => {
                const { shipment, route, pinX, pinY, cardX, cardY } =
                  highlightedRouteNode;
                const waypoints = route.waypoints;
                const currentIdx = route.currentWaypointIndex;

                return (
                  <g key={`active-route-${shipment.id}`}>
                    {waypoints.slice(0, -1).map((wp, segIdx) => {
                      const nextWp = waypoints[segIdx + 1];
                      const isCompletedSegment = segIdx < currentIdx;
                      const pathD = buildCurvedSvgPath(
                        wp.x,
                        wp.y,
                        nextWp.x,
                        nextWp.y
                      );

                      return (
                        <React.Fragment key={`active-seg-${segIdx}`}>
                          {isCompletedSegment ? (
                            <>
                              <path
                                d={pathD}
                                fill="none"
                                stroke="url(#routeActiveGrad)"
                                strokeWidth="3.4"
                                strokeLinecap="round"
                                filter="url(#glowRoute)"
                              />
                              <path
                                d={pathD}
                                fill="none"
                                stroke="#f8fafc"
                                strokeWidth="1.4"
                                strokeDasharray="4 8"
                                opacity="0.9"
                              />
                            </>
                          ) : (
                            <path
                              d={pathD}
                              fill="none"
                              stroke="#6366f1"
                              strokeWidth="2"
                              strokeDasharray="5 5"
                              opacity="0.85"
                            />
                          )}
                        </React.Fragment>
                      );
                    })}

                    {/* Linha direta do pino atual até o card focado */}
                    <line
                      x1={pinX}
                      y1={pinY}
                      x2={cardX}
                      y2={cardY}
                      stroke="#818cf8"
                      strokeWidth="1.8"
                      strokeDasharray="3 3"
                    />

                    {/* Pinos numerados das paradas da rota do pacote focado */}
                    {waypoints.map((wp, idx) => (
                      <g key={`wp-dot-${wp.id}`}>
                        <circle
                          cx={wp.x}
                          cy={wp.y}
                          r={idx === currentIdx ? 7 : 4.5}
                          fill={
                            idx < currentIdx
                              ? '#38bdf8'
                              : idx === currentIdx
                              ? '#f59e0b'
                              : '#1e293b'
                          }
                          stroke="#f8fafc"
                          strokeWidth="1.6"
                        />
                      </g>
                    ))}
                  </g>
                );
              })()}

              {/* MARCADORES DE REFERÊNCIA NO BRASIL (Curitiba & Minas Gerais) */}
              <g className="pointer-events-none">
                <circle
                  cx={BRAZIL_CUSTOMS_COORDS.x}
                  cy={BRAZIL_CUSTOMS_COORDS.y}
                  r="3.5"
                  fill="#f43f5e"
                />
                <circle
                  cx={BRAZIL_DESTINATION_COORDS.x}
                  cy={BRAZIL_DESTINATION_COORDS.y}
                  r="4"
                  fill="#10b981"
                />
              </g>
            </svg>

            {/* CAMADA 2: PILHAS DE PACOTES EM CASCATA ("UM ATRÁS DO OUTRO" ESTILO BARALHO) */}
            <div className="absolute inset-0 pointer-events-none">
              {stackClusters.map((cluster) => {
                const headerLeft = (cluster.baseX / 1000) * 100;
                const headerTop = ((cluster.baseY - 46) / 560) * 100;

                return (
                  <React.Fragment key={cluster.stackKey}>
                    {/* Cabeçalho compacto da Pilha quando houver mais de 1 pacote */}
                    {cluster.cards.length > 1 && (
                      <div
                        style={{
                          left: `${headerLeft}%`,
                          top: `${Math.max(2, headerTop)}%`,
                        }}
                        className="pointer-events-none absolute -translate-x-1/2 -translate-y-full z-30 mb-1"
                      >
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-900/95 border border-slate-700/90 px-2 py-0.5 text-[9px] font-semibold text-slate-300 shadow-lg whitespace-nowrap">
                          <Layers className="w-2.5 h-2.5 text-indigo-400" />
                          <span>{cluster.stackTitle}</span>
                          <span className="rounded-full bg-indigo-500/25 border border-indigo-400/40 px-1.5 text-[9px] font-bold text-indigo-200">
                            {cluster.cards.length}
                          </span>
                        </span>
                      </div>
                    )}

                    {/* Cartas da Pilha: a carta 0 fica na frente por padrão (igual no Brasil),
                        e as de trás deixam a aba inferior (nome, qtd CDs e R$) visível.
                        Ao passar o mouse em qualquer carta de trás, ela sobe para a frente na hora! */}
                    {cluster.cards.map(
                      ({
                        shipment,
                        summary,
                        route,
                        stackIndex,
                        stackCount,
                        cardX,
                        cardY,
                      }) => {
                        const leftPercent = (cardX / 1000) * 100;
                        const topPercent = (cardY / 560) * 100;
                        const isHovered = hoveredShipmentId === shipment.id;
                        const isModalOpen = modalShipmentId === shipment.id;

                        // Z-index em cascata: index 0 tem maior z-index natural para que as cartas seguintes fiquem logo atrás mostrando a base (igual na imagem 3 do Brasil).
                        // Quando o usuário passa o mouse em qualquer carta de trás, ela recebe zIndex 50 e sobe para o topo!
                        const baseZIndex = 30 - stackIndex;
                        const effectiveZIndex = isHovered
                          ? 50
                          : isModalOpen
                          ? 45
                          : Math.max(10, baseZIndex);

                        const statusMeta = STATUS_LABELS[shipment.status];
                        const items = summary?.items || [];
                        const previewItems = items.slice(0, 4);
                        const extraItemsCount = Math.max(0, items.length - 4);
                        const forwarder = route.forwarder;

                        return (
                          <div
                            key={shipment.id}
                            style={{
                              left: `${leftPercent}%`,
                              top: `${topPercent}%`,
                              zIndex: effectiveZIndex,
                            }}
                            onMouseEnter={() =>
                              setHoveredShipmentId(shipment.id)
                            }
                            onMouseLeave={() => setHoveredShipmentId(null)}
                            onClick={() => handleClickMiniature(shipment.id)}
                            className={`pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 w-[154px] sm:w-[164px] rounded-xl border p-2 transition-all duration-150 cursor-pointer backdrop-blur-md ${
                              isHovered
                                ? 'scale-105 bg-slate-900 border-indigo-400 ring-2 ring-indigo-500/40 shadow-2xl shadow-indigo-950/90'
                                : isModalOpen
                                ? 'bg-slate-900 border-indigo-500 shadow-xl'
                                : 'bg-slate-900/95 border-slate-700/90 hover:border-slate-500 shadow-[0_8px_20px_rgba(0,0,0,0.75)]'
                            }`}
                          >
                            {/* Linha 1: Bandeira Origem + Redirecionador + Status */}
                            <div className="flex items-center justify-between gap-1 mb-1">
                              <div className="flex items-center gap-1 min-w-0">
                                <span
                                  title={`Origem: ${route.originCountryName}`}
                                  className="text-xs shrink-0"
                                >
                                  {route.originFlag}
                                </span>
                                {forwarder ? (
                                  <span
                                    className={`truncate rounded border px-1 py-0.2 text-[9px] font-semibold ${forwarder.badgeClass}`}
                                    title={`Redirecionador: ${forwarder.name} (${forwarder.cityLabel})`}
                                  >
                                    {forwarder.name}
                                  </span>
                                ) : (
                                  <span className="truncate text-[9px] text-slate-300 font-medium">
                                    {route.originCountryName}
                                  </span>
                                )}
                              </div>

                              <span
                                className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.2 text-[8px] font-semibold shrink-0 ${statusMeta.badgeClass}`}
                              >
                                {shipment.status === 'em_transito' ? (
                                  <Plane className="w-2.5 h-2.5" />
                                ) : (
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full ${statusMeta.dotClass}`}
                                  />
                                )}
                                {statusMeta.shortLabel}
                              </span>
                            </div>

                            {/* Linha 2: Faixa de Capas dos Álbuns */}
                            <div className="flex items-center gap-1 my-1 bg-slate-950/90 rounded-lg p-1 border border-slate-800/90">
                              {previewItems.length > 0 ? (
                                previewItems.map((cd) => (
                                  <div
                                    key={cd.id}
                                    title={`${cd.artist} — ${cd.albumTitle}`}
                                    className="w-6 h-6 rounded overflow-hidden shrink-0 border border-slate-700/70"
                                  >
                                    <AlbumCover
                                      src={cd.coverUrl}
                                      alt={`${cd.artist} — ${cd.albumTitle}`}
                                      className="h-full w-full object-cover"
                                      iconClassName="w-3.5 h-3.5 text-slate-600"
                                    />
                                  </div>
                                ))
                              ) : (
                                <div className="flex items-center gap-1 text-[10px] text-slate-500 py-0.5 px-1">
                                  <Disc3 className="w-3.5 h-3.5" />
                                  <span>Sem álbuns</span>
                                </div>
                              )}
                              {extraItemsCount > 0 && (
                                <div className="w-6 h-6 rounded bg-indigo-950/90 border border-indigo-500/40 flex items-center justify-center text-[9px] font-bold text-indigo-300 shrink-0">
                                  +{extraItemsCount}
                                </div>
                              )}
                            </div>

                            {/* Linha 3 (Parte que fica sempre visível na cascata para as cartas de trás): Nome + Qtd CDs + Preço BRL */}
                            <div className="min-w-0 pt-0.5">
                              <p
                                className="text-[10px] font-bold text-white truncate"
                                title={shipment.name}
                              >
                                {shipment.name}
                              </p>
                              <div className="flex items-center justify-between gap-1 mt-0.5 text-[9.5px] text-slate-400">
                                <span className="font-medium text-slate-300">
                                  {formatMediaCountLabel(
                                    summary?.cdItemsCount || 0,
                                    summary?.vinylItemsCount || 0
                                  )}
                                  {stackCount > 1 && (
                                    <span className="ml-1 text-[8px] text-slate-500">
                                      ({stackIndex + 1}/{stackCount})
                                    </span>
                                  )}
                                </span>
                                <span className="font-mono font-bold text-emerald-400">
                                  {formatBrl(
                                    summary?.totalShipmentCostBrl || 0
                                  )}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      }
                    )}
                  </React.Fragment>
                );
              })}
            </div>

            {/* BARRA INFERIOR DE STATUS DA ROTA QUANDO UM PACOTE ESTÁ SOB O MOUSE */}
            {highlightedRouteNode && (() => {
              const { shipment, route } = highlightedRouteNode;
              return (
                <div className="absolute bottom-3 left-3 right-3 z-40 pointer-events-none flex justify-center">
                  <div className="pointer-events-auto rounded-xl bg-slate-900/95 border border-indigo-500/50 px-4 py-2 shadow-2xl backdrop-blur-md flex flex-wrap items-center gap-3 text-xs">
                    <span className="font-bold text-white flex items-center gap-1.5">
                      <Navigation className="w-3.5 h-3.5 text-indigo-400" />
                      {shipment.name}:
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      {route.waypoints.map((wp, idx) => {
                        const isDone = idx < route.currentWaypointIndex;
                        const isCurrent = idx === route.currentWaypointIndex;
                        return (
                          <React.Fragment key={wp.id}>
                            {idx > 0 && (
                              <span
                                className={
                                  isDone || isCurrent
                                    ? 'text-indigo-400 font-bold'
                                    : 'text-slate-600'
                                }
                              >
                                →
                              </span>
                            )}
                            <span
                              className={`px-2 py-0.5 rounded-md border ${
                                isCurrent
                                  ? 'bg-amber-500/20 border-amber-400 text-amber-200 font-bold'
                                  : isDone
                                  ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300'
                                  : 'bg-slate-950/70 border-slate-800 text-slate-500'
                              }`}
                            >
                              {wp.flag} {wp.title}
                            </span>
                          </React.Fragment>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* JANELA MODAL CENTRALIZADA COM O COMPONENTE <PackageDetailView /> AO CLICAR NO PACOTE */}
      {modalShipmentId && renderSelectedPackageDetail && (
        <div
          onClick={() => setModalShipmentId(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-5 overflow-y-auto"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-5xl max-h-[92vh] flex flex-col rounded-2xl bg-slate-950 border border-indigo-500/40 shadow-2xl overflow-hidden"
          >
            {/* Header Fixo da Janela Modal */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 py-3.5 bg-slate-900/95 border-b border-slate-800 shrink-0">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-indigo-400" />
                <span className="text-xs sm:text-sm font-bold uppercase tracking-wider text-indigo-300">
                  Detalhes do Pacote Selecionado no Mapa
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setModalShipmentId(null);
                    onSwitchToListView();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition cursor-pointer"
                >
                  <List className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Ver na Visão em Lista</span>
                </button>
                <button
                  type="button"
                  onClick={() => setModalShipmentId(null)}
                  title="Fechar janela (ESC)"
                  className="inline-flex items-center gap-1 rounded-xl bg-slate-800/80 hover:bg-rose-500/20 border border-slate-700 hover:border-rose-500/40 px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:text-rose-200 transition cursor-pointer"
                >
                  <X className="w-4 h-4" />
                  <span>Fechar</span>
                </button>
              </div>
            </div>

            {/* Corpo da Modal com Scroll renderizando o PackageDetailView completo */}
            <div className="p-4 sm:p-6 overflow-y-auto flex-1">
              {renderSelectedPackageDetail()}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
