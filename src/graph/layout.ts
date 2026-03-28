import cytoscape from "cytoscape";
import fcose from "cytoscape-fcose";

// Register fcose if not already registered (usually handled in worker but good for tests)
try {
  cytoscape.use(fcose);
} catch (e) {
  // Already registered or error
}

export type Node = {
  id: string;
  x: number;
  y: number;
  radius?: number;
  fixed?: boolean;
  [key: string]: unknown;
};

export type Edge = {
  id?: string;
  source: string;
  target: string;
  idealLength?: number;
  [key: string]: unknown;
};

export type LayoutOptions = {
  name?: string;
  [key: string]: unknown;
};

export class CytoscapeLayout {
  nodes: Node[];
  edges: Edge[];
  options: LayoutOptions;

  constructor(nodes: Node[], edges: Edge[], options?: LayoutOptions) {
    this.nodes = nodes;
    this.edges = edges;
    this.options = options || { name: "fcose" };
  }

  async run(): Promise<{ id: string; x: number; y: number }[]> {
    const cy = cytoscape({
      headless: true,
      elements: {
        nodes: this.nodes.map((n) => ({
          data: { id: n.id, radius: n.radius || 20 },
          position: { x: n.x, y: n.y },
          locked: n.fixed,
        })),
        edges: this.edges.map((e, index) => ({
          data: { id: e.id || `e${index}`, source: e.source, target: e.target },
        })),
      },
      style: [
        {
          selector: "node",
          style: {
            width: (n: any) => (n.data("radius") || 20) * 2,
            height: (n: any) => (n.data("radius") || 20) * 2,
          },
        },
      ],
    });

    const layout = cy.layout({
      animate: false,
      fit: false,
      randomize: false,
      ...this.options,
    } as any);

    const promise = layout.promiseOn("layoutstop");
    layout.run();
    await promise;

    return cy.nodes().map((node) => ({
      id: node.id(),
      x: node.position().x,
      y: node.position().y,
    }));
  }
}

// Keep ForceLayout as an alias or deprecated wrapper if needed by other components,
// but redirecting to Cytoscape for now.
export class ForceLayout extends CytoscapeLayout {
  constructor(nodes: Node[], edges: Edge[], options?: any) {
    super(nodes, edges, { name: "fcose", ...options });
  }

  async runSteps(_count: number): Promise<void> {
    // Cytoscape runs to completion, so we just run it once
    const positions = await this.run();
    // Update internal nodes for getPositions() compatibility
    const posMap = new Map(positions.map((p) => [p.id, p]));
    this.nodes.forEach((n) => {
      const p = posMap.get(n.id);
      if (p) {
        n.x = p.x;
        n.y = p.y;
      }
    });
  }

  getPositions() {
    return this.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y }));
  }
}
