// force-layout.ts
export type Node = {
  id: string;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  mass?: number;
  radius?: number;
  fixed?: boolean;
  // any additional data you want to carry
  [key: string]: unknown;
};

export type Edge = {
  source: string; // node id
  target: string; // node id
  distance?: number; // preferred length
  strength?: number; // spring stiffness
  [key: string]: unknown;
};

export type ForceOptions = {
  // physics params
  attractionStrength?: number; // multiplier for springs (default 0.1)
  repulsionStrength?: number; // multiplier for node repulsion (default 300)
  linkDistance?: number; // default preferred distance (default 80)
  minNodeDistance?: number; // minimum distance between nodes to avoid overlap (default 0 - disabled)
  nodeRadius?: number; // default radius for nodes if not specified on node (default 0)
  collisionStrength?: number; // multiplier for collision force (default 0.5)
  damping?: number; // velocity damping [0..1) (default 0.9)
  gravity?: number; // pulls nodes toward center (default 0.1)
  maxDisplacement?: number; // prevents exploding positions (default 100)
  timeStep?: number; // seconds per tick (default 0.016 ~ 60FPS)
  // integration
  useVerlet?: boolean; // currently we use explicit Euler by default
  // stop criteria
  alpha?: number; // simulation temperature (0..1). If provided, cools each tick by alpha *= (1 - decay)
  alphaDecay?: number; // fraction per tick to reduce alpha (default 0.02)
  // performance
  theta?: number; // for future Barnes-Hut extension; currently unused
};

type InternalNode = Node & {
  vx: number;
  vy: number;
  fx: number;
  fy: number;
  mass: number;
  radius: number;
};

class QuadTree {
  x: number;
  y: number;
  width: number;
  height: number;

  mass: number = 0;
  centerX: number = 0;
  centerY: number = 0;

  node: InternalNode | null = null;

  NW: QuadTree | null = null;
  NE: QuadTree | null = null;
  SW: QuadTree | null = null;
  SE: QuadTree | null = null;

  constructor(x: number, y: number, width: number, height: number) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
  }

  insert(n: InternalNode) {
    if (this.mass === 0) {
      this.mass = n.mass;
      this.centerX = n.x;
      this.centerY = n.y;
      this.node = n;
      return;
    }

    this.centerX =
      (this.centerX * this.mass + n.x * n.mass) / (this.mass + n.mass);
    this.mass += n.mass;

    if (this.node) {
      if (this.node.x === n.x && this.node.y === n.y) {
        n.x += Math.random() * 0.01 - 0.005;
        n.y += Math.random() * 0.01 - 0.005;
      }
      this._insertIntoChildren(this.node);
      this.node = null;
    }

    this._insertIntoChildren(n);
  }

  private _insertIntoChildren(n: InternalNode) {
    const hw = this.width / 2;
    const hh = this.height / 2;

    const left = n.x < this.x + hw;
    const top = n.y < this.y + hh;

    if (top) {
      if (left) {
        if (!this.NW) this.NW = new QuadTree(this.x, this.y, hw, hh);
        this.NW.insert(n);
      } else {
        if (!this.NE) this.NE = new QuadTree(this.x + hw, this.y, hw, hh);
        this.NE.insert(n);
      }
    } else {
      if (left) {
        if (!this.SW) this.SW = new QuadTree(this.x, this.y + hh, hw, hh);
        this.SW.insert(n);
      } else {
        if (!this.SE) this.SE = new QuadTree(this.x + hw, this.y + hh, hw, hh);
        this.SE.insert(n);
      }
    }
  }
}

function buildQuadTree(nodes: InternalNode[]): QuadTree | null {
  if (nodes.length === 0) return null;

  let minX = Infinity,
    minY = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  }

  const width = maxX - minX;
  const height = maxY - minY;
  const size = Math.max(width, height) + 2;

  const tree = new QuadTree(minX - 1, minY - 1, size, size);
  for (const n of nodes) {
    tree.insert(n);
  }
  return tree;
}

function applyRepulsion(
  ni: InternalNode,
  tree: QuadTree,
  opts: Required<ForceOptions>,
  alpha: number,
) {
  if (!tree || tree.mass === 0) return;

  const theta = opts.theta;
  const collisionK = opts.collisionStrength;
  const minNodeDist = opts.minNodeDistance;

  if (tree.node === ni) return;

  let dx = ni.x - tree.centerX;
  let dy = ni.y - tree.centerY;
  let dist2 = dx * dx + dy * dy;

  if (dist2 === 0) {
    dx = Math.random() * 0.1 - 0.05;
    dy = Math.random() * 0.1 - 0.05;
    dist2 = dx * dx + dy * dy;
  }

  const dist = Math.sqrt(dist2);

  if (tree.node !== null || tree.width / dist < theta) {
    const force = (opts.repulsionStrength * ni.mass * tree.mass) / (dist + 1);

    let collisionForce = 0;
    if (tree.node !== null) {
      const nj = tree.node;
      const effectiveMinDist = minNodeDist + ni.radius + nj.radius;
      if (effectiveMinDist > 0 && dist < effectiveMinDist) {
        const overlap = effectiveMinDist - dist;
        collisionForce = collisionK * overlap * 100;
      }
    }

    const totalForce = force + collisionForce;
    const fx = (dx / dist) * totalForce * alpha;
    const fy = (dy / dist) * totalForce * alpha;

    ni.fx += fx;
    ni.fy += fy;
  } else {
    if (tree.NW) applyRepulsion(ni, tree.NW, opts, alpha);
    if (tree.NE) applyRepulsion(ni, tree.NE, opts, alpha);
    if (tree.SW) applyRepulsion(ni, tree.SW, opts, alpha);
    if (tree.SE) applyRepulsion(ni, tree.SE, opts, alpha);
  }
}

export class ForceLayout {
  nodes: InternalNode[];
  edges: Edge[];
  lookup: Map<string, InternalNode>;
  opts: Required<ForceOptions>;

  // callback invoked after each step with current nodes positions
  onTick?: (nodes: Node[], stepCount: number) => Promise<void>;

  private stepCount = 0;
  private running = false;
  private rafId: number | null = null;

  constructor(nodes: Node[], edges: Edge[], options?: ForceOptions) {
    this.opts = {
      attractionStrength: 0.1,
      repulsionStrength: 300,
      linkDistance: 80,
      minNodeDistance: 0,
      nodeRadius: 0,
      collisionStrength: 0.5,
      damping: 0.9,
      gravity: 0.1,
      maxDisplacement: 100,
      timeStep: 0.016,
      useVerlet: false,
      alpha: 1.0,
      alphaDecay: 0.02,
      theta: 0.5,
      ...(options || {}),
    };

    // initialize internal node state
    this.nodes = nodes.map((n) => ({
      ...n,
      vx: n.vx ?? 0,
      vy: n.vy ?? 0,
      fx: 0,
      fy: 0,
      mass: n.mass ?? 1,
      radius: n.radius ?? this.opts.nodeRadius,
    }));

    this.edges = edges.map((e) => ({
      distance: this.opts.linkDistance,
      strength: this.opts.attractionStrength,
      ...e,
    }));

    this.lookup = new Map();
    for (const n of this.nodes) this.lookup.set(n.id, n);
  }

  // single simulation step (deterministic)
  async step(): Promise<void> {
    const { nodes, edges, opts } = this;
    const n = nodes.length;
    this.stepCount++;

    // reset forces
    for (let i = 0; i < n; i++) {
      nodes[i].fx = 0;
      nodes[i].fy = 0;
    }

    // 1) repulsive forces (O(n log n)) via Barnes-Hut
    const alpha = opts.alpha ?? 1.0;
    const tree = buildQuadTree(nodes);

    if (tree) {
      for (let i = 0; i < n; i++) {
        applyRepulsion(nodes[i], tree, opts, alpha);
      }
    }

    // 2) attractive forces (Hooke's law)
    for (const e of edges) {
      const a = this.lookup.get(e.source);
      const b = this.lookup.get(e.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1e-6;
      const desired = e.distance ?? opts.linkDistance;
      const strength = e.strength ?? opts.attractionStrength;

      const f = strength * (dist - desired) * alpha;

      const ux = dx / dist;
      const uy = dy / dist;

      const fx = ux * f;
      const fy = uy * f;

      a.fx += fx;
      a.fy += fy;
      b.fx -= fx;
      b.fy -= fy;
    }

    // 3) central gravity
    for (let i = 0; i < n; i++) {
      const node = nodes[i];
      // Use alpha to cool gravity as well
      const g = opts.gravity * alpha;
      node.fx -= node.x * g * node.mass;
      node.fy -= node.y * g * node.mass;
    }

    // 4) integrate
    const dt = opts.timeStep;
    for (let i = 0; i < n; i++) {
      const node = nodes[i];
      if (node.fixed) {
        node.vx = 0;
        node.vy = 0;
        continue;
      }
      const ax = node.fx / node.mass;
      const ay = node.fy / node.mass;

      node.vx += ax * dt;
      node.vy += ay * dt;

      node.vx *= opts.damping;
      node.vy *= opts.damping;

      let dx = node.vx * dt;
      let dy = node.vy * dt;

      const disp = Math.sqrt(dx * dx + dy * dy);
      if (disp > opts.maxDisplacement) {
        const scale = opts.maxDisplacement / disp;
        dx *= scale;
        dy *= scale;
        node.vx = dx / dt;
        node.vy = dy / dt;
      }

      node.x += dx;
      node.y += dy;
    }

    // cool alpha
    if (opts.alpha !== undefined) {
      opts.alpha *= 1 - opts.alphaDecay;
    }

    // call tick callback with shallow-copied nodes (strip internals)
    if (this.onTick) {
      await this.onTick(
        nodes.map(({ id, x, y, ...rest }) => ({ id, x, y, ...rest })) as Node[],
        this.stepCount,
      );
    }
  }

  // run continuously (uses requestAnimationFrame if available)
  // This method does not start automatically; call it explicitly when you want the simulation to run.
  start(maxSteps = Infinity): void {
    if (this.running) return;
    this.running = true;
    let steps = 0;
    const loop = () => {
      if (!this.running || steps >= maxSteps) {
        this.running = false;
        if (this.rafId != null) {
          cancelAnimationFrame(this.rafId);
          this.rafId = null;
        }
        return;
      }
      this.step();
      steps++;
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  // run a fixed number of synchronous steps (useful for testing or node)
  async runSteps(count: number): Promise<void> {
    for (let i = 0; i < count; i++) await this.step();
  }

  // convenience: get public node positions
  getPositions(): { id: string; x: number; y: number }[] {
    return this.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y }));
  }
}
