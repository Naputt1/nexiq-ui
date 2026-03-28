import cytoscape from "cytoscape";
import fcose from "cytoscape-fcose";

cytoscape.use(fcose);

export type Node = {
  id: string;
  x: number;
  y: number;
  radius?: number;
  fixed?: boolean;
  [key: string]: unknown;
};

export type Edge = {
  id: string;
  source: string;
  target: string;
  idealLength?: number;
  [key: string]: unknown;
};

export type LayoutRequest = {
  type: "layout";
  id: string; // combo id or "root"
  nodes: Node[];
  edges: Edge[];
  layoutType?: string;
  options?: Omit<cytoscape.LayoutOptions, "name">;
};

export type LayoutResponse = {
  type: "layout-result";
  id: string;
  nodes: { id: string; x: number; y: number }[];
};

self.onmessage = async (e: MessageEvent<LayoutRequest>) => {
  const { type, id, nodes, edges, layoutType = "fcose", options = {} } = e.data;

  if (type === "layout") {
    // Initialize headless cytoscape with dimensions and style
    const cy = cytoscape({
      headless: true,
      styleEnabled: true,
      elements: {
        nodes: nodes.map((n) => ({
          data: {
            id: n.id,
            width: (n.radius || 20) * 3,
            height: (n.radius || 20) * 3,
          },
          position: { x: n.x, y: n.y },
          selectable: !n.fixed,
          locked: n.fixed,
        })),
        edges: edges.map((e) => ({
          data: {
            id: e.id,
            source: e.source,
            target: e.target,
            idealLength: (e as any).idealLength,
          },
        })),
      },
      style: [
        {
          selector: "node",
          style: {
            width: "data(width)",
            height: "data(height)",
          },
        },
      ],
    });

    const layout = cy.layout({
      name: layoutType,
      quality: "proof",
      animate: false,
      fit: false,
      randomize: true,
      uniformNodeDimensions: false,
      ...options,
      idealEdgeLength: (edge: any) =>
        edge.data("idealLength") || (options as any).idealEdgeLength || 50,
    } as any);

    const promise = layout.promiseOn("layoutstop");
    layout.run();
    await promise;

    const positions = cy.nodes().map((node) => ({
      id: node.id(),
      x: node.position().x,
      y: node.position().y,
    }));

    self.postMessage({
      type: "layout-result",
      id,
      nodes: positions,
    } as LayoutResponse);
  }
};
