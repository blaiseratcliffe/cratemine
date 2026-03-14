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
 * Randomized scatter layout for seeds while crawling is in progress.
 * Positions are deterministic per node id so they don't jump when new seeds appear.
 */
function SeedScatter({ nodes, width }: { nodes: SceneUser[]; width: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Compute stable positions per node
  const positions = useMemo(() => {
    const pad = 60;
    return nodes.map((n) => ({
      x: pad + idHash(n.id, 1) * (width - pad * 2),
      y: pad + idHash(n.id, 2) * (GRAPH_HEIGHT - pad * 2),
    }));
  }, [nodes, width]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = GRAPH_HEIGHT * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, GRAPH_HEIGHT);

    for (let i = 0; i < nodes.length; i++) {
      const { x, y } = positions[i];

      ctx.beginPath();
      ctx.arc(x, y, 5, 0, 2 * Math.PI);
      ctx.fillStyle = "#f97316";
      ctx.fill();

      ctx.font = "11px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "#fb923c";
      ctx.fillText(nodes[i].username, x, y + 8);
    }
  }, [nodes, width, positions]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      for (let i = 0; i < nodes.length; i++) {
        const { x, y } = positions[i];
        const dist = Math.sqrt((mx - x) ** 2 + (my - y) ** 2);
        if (dist < 15) {
          window.open(
            nodes[i].permalinkUrl,
            "_blank",
            "noopener,noreferrer"
          );
          return;
        }
      }
    },
    [nodes, positions]
  );

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height: GRAPH_HEIGHT, cursor: "pointer" }}
      onClick={handleClick}
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
        <SeedScatter nodes={nodes} width={width} />
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
