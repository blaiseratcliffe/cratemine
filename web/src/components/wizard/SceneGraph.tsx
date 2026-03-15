"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { forceX, forceY } from "d3-force";
import type { SceneUser, SceneEdge, SceneProgress } from "@/types";
import { normalizeCity } from "@/lib/soundcloud/cities";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
});

const GRAPH_HEIGHT = 800;

// Colors for city clusters
const CLUSTER_COLORS = [
  "#f97316", "#3b82f6", "#10b981", "#a855f7", "#ef4444",
  "#eab308", "#06b6d4", "#ec4899", "#84cc16", "#f59e0b",
];

interface Props {
  nodes: SceneUser[];
  edges: SceneEdge[];
  phase: SceneProgress["phase"];
}

/** Mulberry32-based hash from node id + salt to a stable 0-1 value */
function idHash(id: number, salt: number): number {
  let t = (id * 2654435761 + salt * 2246822519) >>> 0;
  t = Math.imul(t ^ (t >>> 16), 2246822507);
  t = Math.imul(t ^ (t >>> 13), 3266489909);
  t = (t ^ (t >>> 16)) >>> 0;
  return t / 0xffffffff;
}

/**
 * Enhanced SeedScatter: topology-aware layout with animated edges and node entrances.
 * Renders during Phase 1-2 as the graph is being built.
 * Seeds on a circle, scene members positioned near their connected seeds.
 */
function SeedScatter({
  nodes,
  edges,
  width,
}: {
  nodes: SceneUser[];
  edges: SceneEdge[];
  width: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodeFirstSeen = useRef(new Map<number, number>());
  const edgeFirstSeen = useRef(new Map<string, number>());
  const rafRef = useRef<number>(0);
  const [hovered, setHovered] = useState<SceneUser | null>(null);
  const mousePos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Clear animation state when discovery resets
  useEffect(() => {
    if (nodes.length === 0) {
      nodeFirstSeen.current.clear();
      edgeFirstSeen.current.clear();
    }
  }, [nodes.length]);

  // Compute topology-aware positions
  const positionMap = useMemo(() => {
    const map = new Map<number, { x: number; y: number }>();
    const pad = 40;
    const cx = width / 2;
    const cy = GRAPH_HEIGHT / 2;
    const circleRadius = Math.min(width, GRAPH_HEIGHT) * 0.33;

    // Separate seeds and members
    const seeds = nodes.filter((n) => n.isSeed);
    const members = nodes.filter((n) => !n.isSeed);

    // Place seeds on a circle, sorted by ID for stability
    const sortedSeeds = [...seeds].sort((a, b) => a.id - b.id);
    const angleStep = sortedSeeds.length > 0 ? (2 * Math.PI) / sortedSeeds.length : 0;

    for (let i = 0; i < sortedSeeds.length; i++) {
      const angle = i * angleStep - Math.PI / 2; // start at top
      map.set(sortedSeeds[i].id, {
        x: cx + circleRadius * Math.cos(angle),
        y: cy + circleRadius * Math.sin(angle),
      });
    }

    // Build a quick lookup: which seeds connect to each member
    const memberSeeds = new Map<number, number[]>();
    for (const e of edges) {
      if (map.has(e.source) && !map.has(e.target)) {
        const list = memberSeeds.get(e.target) || [];
        if (!list.includes(e.source)) list.push(e.source);
        memberSeeds.set(e.target, list);
      }
    }

    // Place members near centroid of connected seeds
    for (const member of members) {
      const connectedSeedIds = memberSeeds.get(member.id) || [];
      const connectedPositions = connectedSeedIds
        .map((id) => map.get(id))
        .filter(Boolean) as { x: number; y: number }[];

      let x: number;
      let y: number;

      if (connectedPositions.length > 0) {
        // Centroid of connected seeds
        const centX = connectedPositions.reduce((s, p) => s + p.x, 0) / connectedPositions.length;
        const centY = connectedPositions.reduce((s, p) => s + p.y, 0) / connectedPositions.length;

        // Deterministic offset from centroid
        const offsetAngle = idHash(member.id, 3) * 2 * Math.PI;
        const offsetDist = connectedPositions.length > 1
          ? 20 + idHash(member.id, 4) * 30  // closer if multi-connected
          : 60 + idHash(member.id, 4) * 60;  // further if single seed
        x = centX + offsetDist * Math.cos(offsetAngle);
        y = centY + offsetDist * Math.sin(offsetAngle);
      } else {
        // Fallback: hash-based scatter
        x = pad + idHash(member.id, 1) * (width - pad * 2);
        y = pad + idHash(member.id, 2) * (GRAPH_HEIGHT - pad * 2);
      }

      // Clamp to canvas bounds
      x = Math.max(pad, Math.min(width - pad, x));
      y = Math.max(pad, Math.min(GRAPH_HEIGHT - pad, y));
      map.set(member.id, { x, y });
    }

    return map;
  }, [nodes, edges, width]);

  // Filter edges to only those with both endpoints in the node set
  const filteredEdges = useMemo(() => {
    const nodeIds = new Set(nodes.map((n) => n.id));
    return edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
  }, [nodes, edges]);

  // Animation render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = GRAPH_HEIGHT * dpr;
    ctx.scale(dpr, dpr);

    let running = true;

    function draw() {
      if (!running || !ctx) return;
      const now = performance.now();
      ctx.clearRect(0, 0, width, GRAPH_HEIGHT);

      // --- Draw edges FIRST (behind nodes) ---
      for (const edge of filteredEdges) {
        const key = `${edge.source}-${edge.target}`;
        if (!edgeFirstSeen.current.has(key)) {
          edgeFirstSeen.current.set(key, now);
        }
        const sourcePos = positionMap.get(edge.source);
        const targetPos = positionMap.get(edge.target);
        if (!sourcePos || !targetPos) continue;

        const elapsed = now - edgeFirstSeen.current.get(key)!;
        const t = Math.min(elapsed / 250, 1);

        // Partial line from source toward target
        const endX = sourcePos.x + (targetPos.x - sourcePos.x) * t;
        const endY = sourcePos.y + (targetPos.y - sourcePos.y) * t;

        ctx.beginPath();
        ctx.moveTo(sourcePos.x, sourcePos.y);
        ctx.lineTo(endX, endY);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      // --- Draw nodes ---
      for (const node of nodes) {
        if (!nodeFirstSeen.current.has(node.id)) {
          nodeFirstSeen.current.set(node.id, now);
        }
        const pos = positionMap.get(node.id);
        if (!pos) continue;

        const elapsed = now - nodeFirstSeen.current.get(node.id)!;
        const t = Math.min(elapsed / 180, 1);
        const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic

        const baseRadius = node.isSeed
          ? 5
          : Math.max(2, Math.min(1 + node.followedByCount * 1.5, 8));
        const r = baseRadius * eased;

        if (r < 0.5) continue; // too small to see

        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r, 0, 2 * Math.PI);
        ctx.fillStyle = node.isSeed ? "#f97316" : "#a1a1aa";
        ctx.fill();

        // Labels: show once animation is mostly done
        if (eased > 0.5) {
          ctx.font = "11px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillStyle = node.isSeed ? "#fb923c" : "#71717a";
          ctx.globalAlpha = eased;
          ctx.fillText(node.username, pos.x, pos.y + r + 2);
          ctx.globalAlpha = 1;
        }
      }

      // --- Hover tooltip ---
      if (hovered) {
        const pos = positionMap.get(hovered.id);
        if (pos) {
          const tx = mousePos.current.x + 12;
          const ty = mousePos.current.y - 10;
          const label = `${hovered.username} · ${hovered.followersCount.toLocaleString()} followers`;
          ctx.font = "11px sans-serif";
          const metrics = ctx.measureText(label);
          const pw = metrics.width + 12;
          const ph = 20;

          ctx.fillStyle = "rgba(24, 24, 27, 0.9)";
          ctx.beginPath();
          ctx.roundRect(tx, ty - ph / 2, pw, ph, 4);
          ctx.fill();

          ctx.fillStyle = "#e4e4e7";
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText(label, tx + 6, ty);
        }
      }

      // Continue loop if any animation still running
      const hasActiveNodeAnim = nodes.some((n) => {
        const ts = nodeFirstSeen.current.get(n.id);
        return ts !== undefined && now - ts < 200;
      });
      const hasActiveEdgeAnim = filteredEdges.some((e) => {
        const ts = edgeFirstSeen.current.get(`${e.source}-${e.target}`);
        return ts !== undefined && now - ts < 300;
      });

      if (hasActiveNodeAnim || hasActiveEdgeAnim || hovered) {
        rafRef.current = requestAnimationFrame(draw);
      }
    }

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [nodes, edges, width, positionMap, filteredEdges, hovered]);

  // Mouse handlers for hover and click
  const getNodeAt = useCallback(
    (mx: number, my: number): SceneUser | null => {
      for (const node of nodes) {
        const pos = positionMap.get(node.id);
        if (!pos) continue;
        const dist = Math.sqrt((mx - pos.x) ** 2 + (my - pos.y) ** 2);
        if (dist < 15) return node;
      }
      return null;
    },
    [nodes, positionMap]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const node = getNodeAt(mx, my);
      if (node?.permalinkUrl) {
        window.open(node.permalinkUrl, "_blank", "noopener,noreferrer");
      }
    },
    [getNodeAt]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      mousePos.current = { x: mx, y: my };
      const node = getNodeAt(mx, my);
      setHovered(node);
      canvas.style.cursor = node ? "pointer" : "default";
    },
    [getNodeAt]
  );

  const handleMouseLeave = useCallback(() => {
    setHovered(null);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height: GRAPH_HEIGHT }}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    />
  );
}

/**
 * Scene graph visualization.
 * - During "graph" phase (crawling): static circle of seeds
 * - After crawling (tracks/done): force-directed network
 */
export function SceneGraph({ nodes, edges, phase }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [groupByCity, setGroupByCity] = useState(false);
  const [hoveredCity, setHoveredCity] = useState<string | null>(null);

  // Track container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const showForceGraph = phase === "tracks" || phase === "done";

  // Compute city cluster positions (normalized)
  const cityClusterInfo = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of nodes) {
      const city = normalizeCity(n.city);
      counts.set(city, (counts.get(city) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const positions = new Map<string, { x: number; y: number; color: string; count: number }>();
    const cols = Math.max(Math.ceil(Math.sqrt(sorted.length)), 1);
    const rows = Math.ceil(sorted.length / cols);
    const cellW = width / (cols + 1);
    const cellH = GRAPH_HEIGHT / (rows + 1);
    for (let i = 0; i < sorted.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      positions.set(sorted[i][0], {
        x: cellW * (col + 1) - width / 2,
        y: cellH * (row + 1) - GRAPH_HEIGHT / 2,
        color: CLUSTER_COLORS[i % CLUSTER_COLORS.length],
        count: sorted[i][1],
      });
    }
    return positions;
  }, [nodes, width]);

  // Configure forces once when force graph mounts
  const forcesConfigured = useRef(false);
  useEffect(() => {
    if (!showForceGraph) {
      forcesConfigured.current = false;
      return;
    }
    const fg = fgRef.current;
    if (!fg || forcesConfigured.current) return;
    forcesConfigured.current = true;
    fg.d3Force("charge")?.strength(-80);
    fg.d3Force("link")?.distance(140);
  });

  // Apply or remove city clustering forces
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || !showForceGraph) return;

    if (groupByCity) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fg.d3Force("cityX", forceX((node: any) => {
        const city = normalizeCity(node.city as string);
        return cityClusterInfo.get(city)?.x ?? 0;
      }).strength(0.4));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fg.d3Force("cityY", forceY((node: any) => {
        const city = normalizeCity(node.city as string);
        return cityClusterInfo.get(city)?.y ?? 0;
      }).strength(0.4));

      fg.d3Force("link")?.distance(160);
      fg.d3Force("charge")?.strength(-40);
    } else {
      fg.d3Force("cityX", null);
      fg.d3Force("cityY", null);
      fg.d3Force("link")?.distance(140);
      fg.d3Force("charge")?.strength(-80);
    }

    fg.d3ReheatSimulation();
  }, [groupByCity, showForceGraph, cityClusterInfo]);

  const graphData = useMemo(() => {
    if (!showForceGraph) return { nodes: [], links: [] };

    const nodeIds = new Set(nodes.map((n) => n.id));

    const edgeMap = new Map<string, { source: number; target: number }>();
    for (const e of edges) {
      if (nodeIds.has(e.source) && nodeIds.has(e.target)) {
        const key = `${e.source}-${e.target}`;
        if (!edgeMap.has(key)) {
          edgeMap.set(key, { source: e.source, target: e.target });
        }
      }
    }

    return {
      nodes: nodes.map((n) => ({
        id: n.id,
        username: n.username,
        permalinkUrl: n.permalinkUrl,
        city: n.city,
        isSeed: n.isSeed,
        followedByCount: n.followedByCount,
        val: n.isSeed ? 8 : Math.max(2, Math.min(n.followedByCount * 2, 12)),
      })),
      links: Array.from(edgeMap.values()),
    };
  }, [nodes, edges, showForceGraph]);

  // Node renderer — color by city cluster when grouped
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeCanvasObject = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = (node.x as number) ?? 0;
      const y = (node.y as number) ?? 0;
      const isSeed = node.isSeed as boolean;
      const fbc = (node.followedByCount as number) ?? 0;
      const username = (node.username as string) ?? "";
      const city = normalizeCity(node.city as string);
      let r = isSeed ? 5 : Math.max(2, Math.min(fbc * 1.5, 8));

      const isHighlighted = hoveredCity && city === hoveredCity;
      const isDimmed = hoveredCity && city !== hoveredCity;

      // Enlarge highlighted nodes
      if (isHighlighted) r *= 1.4;

      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI, false);

      if (isDimmed) {
        ctx.fillStyle = "#27272a"; // dark grey for dimmed nodes
      } else if (groupByCity) {
        const cluster = cityClusterInfo.get(city);
        ctx.fillStyle = cluster?.color ?? "#a1a1aa";
      } else {
        ctx.fillStyle = isSeed ? "#f97316" : "#a1a1aa";
      }
      ctx.fill();

      // Show labels for highlighted nodes, or normal zoom-based labels
      const showLabel = isHighlighted
        || globalScale > 1.5
        || (isSeed && globalScale > 0.8);

      if (showLabel && !isDimmed) {
        const fontSize = Math.max(10 / globalScale, 2);
        ctx.font = `${fontSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = isHighlighted ? "#ffffff" : isSeed ? "#fb923c" : "#71717a";
        ctx.fillText(username, x, y + r + 1);
      }
    },
    [groupByCity, cityClusterInfo, hoveredCity]
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleNodeClick = useCallback((node: any) => {
    const url = node.permalinkUrl as string;
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const linkColorFn = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (link: any) => {
      if (!hoveredCity) return "rgba(255,255,255,0.06)";
      const sourceCity = normalizeCity(link.source?.city as string);
      const targetCity = normalizeCity(link.target?.city as string);
      if (sourceCity === hoveredCity || targetCity === hoveredCity) {
        return "rgba(255,255,255,0.15)";
      }
      return "rgba(255,255,255,0.02)";
    },
    [hoveredCity]
  );
  const nodeModeFn = useCallback(() => "replace" as const, []);

  if (nodes.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="relative w-full bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden"
      style={{ height: GRAPH_HEIGHT }}
    >
      {showForceGraph && (
        <button
          onClick={() => setGroupByCity((v) => !v)}
          className={`absolute top-3 right-3 z-10 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            groupByCity
              ? "bg-orange-500 text-white hover:bg-orange-600"
              : "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
          }`}
        >
          {groupByCity ? "Free layout" : "Group by city"}
        </button>
      )}
      {!showForceGraph ? (
        <SeedScatter nodes={nodes} edges={edges} width={width} />
      ) : (
        <ForceGraph2D
          ref={fgRef}
          graphData={graphData}
          width={width}
          height={GRAPH_HEIGHT}
          backgroundColor="transparent"
          nodeId="id"
          nodeVal="val"
          nodeCanvasObject={nodeCanvasObject}
          nodeCanvasObjectMode={nodeModeFn}
          linkColor={linkColorFn}
          linkWidth={0.5}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
          cooldownTime={15000}
          onNodeClick={handleNodeClick}
          enableNodeDrag={true}
          enableZoomInteraction={true}
          minZoom={0.3}
          maxZoom={5}
        />
      )}
      {showForceGraph && groupByCity && (
        <div
          className="absolute bottom-3 right-3 z-10 bg-zinc-800/90 border border-zinc-700 rounded-md px-3 py-2 max-h-48 overflow-y-auto"
          onMouseLeave={() => setHoveredCity(null)}
        >
          {[...cityClusterInfo.entries()].map(([city, info]) => (
            <div
              key={city}
              className="flex items-center gap-2 text-xs py-0.5 cursor-pointer transition-opacity"
              style={{ opacity: hoveredCity && hoveredCity !== city ? 0.4 : 1 }}
              onMouseEnter={() => setHoveredCity(city)}
            >
              <span
                className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: info.color }}
              />
              <span className="text-zinc-300">{city}</span>
              <span className="text-zinc-500">{info.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
