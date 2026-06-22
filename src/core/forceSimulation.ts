/**
 * ForceSimulation — physics engine for the chord graph.
 *
 * Same constants and algorithm as the blog ProgressionGraph.
 * Imperative DOM updates via getNodeEl/getEdgeEl callbacks.
 * React owns topology; this class owns mutable positions.
 */

export interface SimNode {
  id: string;
  r: number; // radius
}

export interface SimEdge {
  key: string;     // "source->target"
  source: string;
  target: string;
}

interface InternalNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  pinned: boolean;
}

// Circle-of-fifths order: pitch class → position index (0-11)
const COF_ORDER: Record<number, number> = {
  0: 0,   // C
  7: 1,   // G
  2: 2,   // D
  9: 3,   // A
  4: 4,   // E
  11: 5,  // B
  6: 6,   // F#/Gb
  1: 7,   // Db/C#
  8: 8,   // Ab/G#
  3: 9,   // Eb/D#
  10: 10, // Bb/A#
  5: 11,  // F
};

// Physics constants (same as blog)
const REPULSION = 30000;
const DAMPING = 0.4;
const CENTER_PULL = 0.008;
const SPRING_LEN = 160;
const SPRING_STRENGTH = 0.1;
const MIN_VELOCITY = 0.5;
const NODE_VEL_KILL = 0.05;
const MAX_VEL = 8;

export class ForceSimulation {
  private nodes: InternalNode[] = [];
  private edges: SimEdge[] = [];
  private nodeIdx = new Map<string, number>();
  private running = false;
  private rafId = 0;
  private width: number;
  private height: number;
  private cx: number;
  private cy: number;
  private getNodeEl: (id: string) => SVGGElement | null;
  private getEdgeEl: (key: string) => SVGPathElement | null;
  private reciprocalSet = new Set<string>();

  constructor(
    getNodeEl: (id: string) => SVGGElement | null,
    getEdgeEl: (key: string) => SVGPathElement | null,
    width: number,
    height: number,
  ) {
    this.getNodeEl = getNodeEl;
    this.getEdgeEl = getEdgeEl;
    this.width = width;
    this.height = height;
    this.cx = width / 2;
    this.cy = height / 2;
  }

  /** Set graph data. Preserves positions of existing nodes by ID. */
  setData(
    simNodes: SimNode[],
    simEdges: SimEdge[],
    rootPitchClasses?: Map<string, number>,
    savedPositions?: Map<string, { x: number; y: number }>,
  ): void {
    const oldPositions = new Map<string, { x: number; y: number }>();
    for (const n of this.nodes) {
      oldPositions.set(n.id, { x: n.x, y: n.y });
    }

    // Build edge set for reciprocal detection
    const edgeKeys = new Set(simEdges.map(e => e.key));
    this.reciprocalSet.clear();
    for (const e of simEdges) {
      const reverseKey = `${e.target}->${e.source}`;
      if (edgeKeys.has(reverseKey)) {
        this.reciprocalSet.add(e.key);
      }
    }

    this.edges = simEdges;

    const newNodes: InternalNode[] = [];
    const existingNodes: InternalNode[] = [];

    for (const sn of simNodes) {
      const old = oldPositions.get(sn.id);
      if (old) {
        existingNodes.push({
          id: sn.id, x: old.x, y: old.y, vx: 0, vy: 0, r: sn.r, pinned: false,
        });
      } else {
        newNodes.push({
          id: sn.id, x: 0, y: 0, vx: 0, vy: 0, r: sn.r, pinned: false,
        });
      }
    }

    const radius = Math.min(this.width, this.height) * 0.35;

    // Seed new node positions
    if (existingNodes.length === 0 && newNodes.length > 0) {
      // First build
      if (savedPositions) {
        // Restore saved positions; fall back to circle-of-fifths for any missing
        for (const n of newNodes) {
          const saved = savedPositions.get(n.id);
          if (saved) {
            n.x = saved.x;
            n.y = saved.y;
          } else {
            const pc = rootPitchClasses?.get(n.id);
            const cofIdx = pc !== undefined ? (COF_ORDER[pc] ?? 0) : 0;
            const angle = (cofIdx / 12) * 2 * Math.PI - Math.PI / 2;
            n.x = this.cx + Math.cos(angle) * radius;
            n.y = this.cy + Math.sin(angle) * radius;
          }
        }
      } else if (rootPitchClasses) {
        // Circle-of-fifths seeding
        for (const n of newNodes) {
          const pc = rootPitchClasses.get(n.id);
          const cofIdx = pc !== undefined ? (COF_ORDER[pc] ?? 0) : 0;
          const angle = (cofIdx / 12) * 2 * Math.PI - Math.PI / 2;
          n.x = this.cx + Math.cos(angle) * radius;
          n.y = this.cy + Math.sin(angle) * radius;
        }
      } else {
        // Generic circle fallback
        const angleStep = (2 * Math.PI) / newNodes.length;
        for (let i = 0; i < newNodes.length; i++) {
          newNodes[i].x = this.cx + Math.cos(angleStep * i - Math.PI / 2) * radius;
          newNodes[i].y = this.cy + Math.sin(angleStep * i - Math.PI / 2) * radius;
        }
      }
    } else {
      // Incremental: seed near connected neighbors
      for (const n of newNodes) {
        const neighbors: { x: number; y: number }[] = [];
        for (const e of this.edges) {
          if (e.source === n.id) {
            const nb = oldPositions.get(e.target);
            if (nb) neighbors.push(nb);
          }
          if (e.target === n.id) {
            const nb = oldPositions.get(e.source);
            if (nb) neighbors.push(nb);
          }
        }
        if (neighbors.length > 0) {
          const ax = neighbors.reduce((s, p) => s + p.x, 0) / neighbors.length;
          const ay = neighbors.reduce((s, p) => s + p.y, 0) / neighbors.length;
          n.x = ax + (Math.random() - 0.5) * 60;
          n.y = ay + (Math.random() - 0.5) * 60;
        } else {
          const angle = Math.random() * 2 * Math.PI;
          n.x = this.cx + Math.cos(angle) * 150;
          n.y = this.cy + Math.sin(angle) * 150;
        }
      }
    }

    this.nodes = [...existingNodes, ...newNodes];
    this.rebuildIdx();
  }

  private rebuildIdx(): void {
    this.nodeIdx.clear();
    this.nodes.forEach((n, i) => this.nodeIdx.set(n.id, i));
  }

  start(): void {
    if (this.running) return;
    if (this.nodes.length === 0) return;
    // Give nodes a small kick to start movement
    for (const n of this.nodes) {
      if (!n.pinned) {
        n.vx += (Math.random() - 0.5) * 2;
        n.vy += (Math.random() - 0.5) * 2;
      }
    }
    this.running = true;
    this.rafId = requestAnimationFrame(() => this.loop());
  }

  stop(): void {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  resize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    this.cx = w / 2;
    this.cy = h / 2;
  }

  pinNode(id: string, x: number, y: number): void {
    const idx = this.nodeIdx.get(id);
    if (idx === undefined) return;
    const n = this.nodes[idx];
    n.pinned = true;
    n.x = x;
    n.y = y;
    n.vx = 0;
    n.vy = 0;
  }

  unpinNode(id: string): void {
    const idx = this.nodeIdx.get(id);
    if (idx === undefined) return;
    this.nodes[idx].pinned = false;
  }

  getNodePosition(id: string): { x: number; y: number } | undefined {
    const idx = this.nodeIdx.get(id);
    if (idx === undefined) return undefined;
    return { x: this.nodes[idx].x, y: this.nodes[idx].y };
  }

  /** Render current positions to DOM without running physics */
  flush(): void {
    this.updateDOM();
  }

  /** Return current positions of all nodes */
  getPositions(): Map<string, { x: number; y: number }> {
    const positions = new Map<string, { x: number; y: number }>();
    for (const n of this.nodes) {
      positions.set(n.id, { x: n.x, y: n.y });
    }
    return positions;
  }

  dispose(): void {
    this.stop();
    this.nodes = [];
    this.edges = [];
    this.nodeIdx.clear();
  }

  // ── Physics loop ──────────────────────────────────────────

  private loop(): void {
    let totalV = 0;
    for (let s = 0; s < 3; s++) {
      totalV = this.applyForces();
    }
    this.updateDOM();
    if (totalV > MIN_VELOCITY && this.running) {
      this.rafId = requestAnimationFrame(() => this.loop());
    } else {
      this.running = false;
    }
  }

  private applyForces(): number {
    const n = this.nodes.length;

    // Damping
    for (const node of this.nodes) {
      node.vx *= DAMPING;
      node.vy *= DAMPING;
    }

    // Overlap resolution + repulsion
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = this.nodes[i], b = this.nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 0.1;

        // Overlap resolution
        const minDist = a.r + b.r + 8;
        if (dist < minDist) {
          const overlap = (minDist - dist) * 0.5;
          const nx = dx / dist, ny = dy / dist;
          if (!a.pinned) { a.x += nx * overlap; a.y += ny * overlap; }
          if (!b.pinned) { b.x -= nx * overlap; b.y -= ny * overlap; }
        }

        // Repulsion
        let repDist = dist;
        if (repDist < minDist) repDist = minDist;
        const force = REPULSION / (repDist * repDist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        if (!a.pinned) { a.vx += fx; a.vy += fy; }
        if (!b.pinned) { b.vx -= fx; b.vy -= fy; }
      }
    }

    // Spring forces from edges
    for (const edge of this.edges) {
      const ai = this.nodeIdx.get(edge.source);
      const bi = this.nodeIdx.get(edge.target);
      if (ai === undefined || bi === undefined) continue;
      if (edge.source === edge.target) continue; // skip self-loops for spring forces
      const a = this.nodes[ai], b = this.nodes[bi];
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const displacement = dist - SPRING_LEN;
      const force = displacement * SPRING_STRENGTH;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      if (!a.pinned) { a.vx += fx; a.vy += fy; }
      if (!b.pinned) { b.vx -= fx; b.vy -= fy; }
    }

    // Center pull
    for (const node of this.nodes) {
      if (node.pinned) continue;
      node.vx += (this.cx - node.x) * CENTER_PULL;
      node.vy += (this.cy - node.y) * CENTER_PULL;
    }

    // Integrate
    let totalV = 0;
    for (const node of this.nodes) {
      if (node.pinned) continue;
      node.vx = Math.max(-MAX_VEL, Math.min(MAX_VEL, node.vx));
      node.vy = Math.max(-MAX_VEL, Math.min(MAX_VEL, node.vy));
      if (Math.abs(node.vx) < NODE_VEL_KILL) node.vx = 0;
      if (Math.abs(node.vy) < NODE_VEL_KILL) node.vy = 0;
      node.x += node.vx;
      node.y += node.vy;
      node.x = Math.max(node.r, Math.min(this.width - node.r, node.x));
      node.y = Math.max(node.r, Math.min(this.height - node.r, node.y));
      totalV += Math.abs(node.vx) + Math.abs(node.vy);
    }

    return totalV;
  }

  // ── Imperative DOM updates ────────────────────────────────

  private updateDOM(): void {
    // Update node positions
    for (const node of this.nodes) {
      const el = this.getNodeEl(node.id);
      if (el) {
        el.setAttribute('transform', `translate(${node.x},${node.y})`);
      }
    }

    // Update edge paths
    for (const edge of this.edges) {
      const pathEl = this.getEdgeEl(edge.key);
      if (!pathEl) continue;

      const ai = this.nodeIdx.get(edge.source);
      const bi = this.nodeIdx.get(edge.target);
      if (ai === undefined || bi === undefined) continue;
      const a = this.nodes[ai], b = this.nodes[bi];

      if (edge.source === edge.target) {
        // Self-loop
        const loopR = a.r * 0.6;
        const x = a.x, y = a.y - a.r;
        pathEl.setAttribute('d',
          `M ${x - loopR * 0.5} ${y} ` +
          `C ${x - loopR} ${y - loopR * 2} ${x + loopR} ${y - loopR * 2} ${x + loopR * 0.5} ${y}`
        );
      } else {
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = dx / dist, ny = dy / dist;

        // Endpoint shortening
        const x1 = a.x + nx * (a.r + 2);
        const y1 = a.y + ny * (a.r + 2);
        const x2 = b.x - nx * (b.r + 2);
        const y2 = b.y - ny * (b.r + 2);

        if (this.reciprocalSet.has(edge.key)) {
          // Curved — offset perpendicular
          const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
          const perpX = -ny, perpY = nx;
          const offset = 20;
          const cx = mx + perpX * offset;
          const cy = my + perpY * offset;
          pathEl.setAttribute('d', `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`);
        } else {
          pathEl.setAttribute('d', `M ${x1} ${y1} L ${x2} ${y2}`);
        }
      }
    }
  }
}
