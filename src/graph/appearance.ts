import {
  DEFAULT_GRAPH_APPEARANCE,
  normalizeGraphAppearance,
  type GraphAppearance,
  type NodeAppearance,
  type AppearanceOverride,
} from "@nexiq/extension-sdk";

type Theme = "dark" | "light";

type NodeAppearanceKey =
  | "package"
  | "scope"
  | "component"
  | "hook"
  | "renderGroup"
  | "sourceGroup"
  | "pathGroup"
  | "callback"
  | "state"
  | "memo"
  | "ref"
  | "effect"
  | "prop"
  | "render";

export function getGraphAppearance(
  appearance?: GraphAppearance,
): GraphAppearance {
  return normalizeGraphAppearance(appearance);
}

export function getNodeAppearanceKey(
  type?: string,
  id?: string,
): NodeAppearanceKey | undefined {
  if (type === "package") return "package";
  if (type === "scope") return "scope";
  if (type === "component") return "component";
  if (type === "hook") return "hook";
  if (type === "render-group") return "renderGroup";
  if (type === "source-group") return "sourceGroup";
  if (type === "path-group") return "pathGroup";
  if (type === "callback") return "callback";
  if (type === "state") return "state";
  if (type === "memo") return "memo";
  if (type === "ref") return "ref";
  if (type === "effect") return "effect";
  if (type === "prop") return "prop";
  if (type === "render") return "render";
  if (id?.endsWith("-props")) return "prop";
  if (id?.endsWith("-render")) return "render";
  return undefined;
}

export function resolveNodeAppearance(
  appearance: GraphAppearance | undefined,
  type?: string,
  id?: string,
  override?: AppearanceOverride,
): NodeAppearance {
  const normalized = getGraphAppearance(appearance);
  const key = getNodeAppearanceKey(type, id);

  let base: NodeAppearance;
  if (!key) {
    base = {
      color: DEFAULT_GRAPH_APPEARANCE.nodes?.component?.color,
      radius: DEFAULT_GRAPH_APPEARANCE.nodes?.component?.radius,
    };
  } else {
    base = normalized.nodes?.[key] || {};
  }

  return {
    color: override?.color ?? base.color,
    radius: override?.radius ?? base.radius,
  };
}

export function getDefaultArrowColor(
  appearance: GraphAppearance | undefined,
  theme: Theme,
) {
  return appearance?.arrowColor || (theme === "dark" ? "#666" : "#666666");
}

export function getDirectFlowColor(
  appearance: GraphAppearance | undefined,
  theme: Theme,
) {
  return (
    appearance?.directFlowColor || (theme === "dark" ? "#60a5fa" : "#2563eb")
  );
}

export function getSideEffectFlowColor(
  appearance: GraphAppearance | undefined,
  _theme: Theme,
) {
  return appearance?.sideEffectFlowColor || "#f59e0b";
}
