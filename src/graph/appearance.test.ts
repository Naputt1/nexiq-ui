import { describe, expect, it } from "vitest";
import { resolveNodeAppearance } from "./appearance";
import { DEFAULT_GRAPH_APPEARANCE } from "@nexiq/extension-sdk";

describe("appearance resolution", () => {
  const customColors = {
    nodes: {
      component: { color: "blue", radius: 20 },
      effect: { color: "#eab308", radius: 14 },
    },
  };

  it("resolves default component appearance", () => {
    const result = resolveNodeAppearance(customColors, "component", "id-1");
    expect(result).toEqual({ color: "blue", radius: 20 });
  });

  it("resolves effect node appearance with default yellow styling", () => {
    const result = resolveNodeAppearance(customColors, "effect", "id-2");
    expect(result).toEqual({ color: "#eab308", radius: 14 });
  });

  it("prioritizes appearanceOverride over theme defaults", () => {
    const override = { color: "red", radius: 50 };
    const result = resolveNodeAppearance(
      customColors,
      "component",
      "id-1",
      override,
    );
    expect(result).toEqual({ color: "red", radius: 50 });
  });

  it("partially overrides appearance", () => {
    const override = { color: "green" };
    const result = resolveNodeAppearance(
      customColors,
      "effect",
      "id-2",
      override,
    );
    expect(result).toEqual({ color: "green", radius: 14 });
  });

  it("falls back to component for unknown types", () => {
    const result = resolveNodeAppearance(customColors, "unknown", "id-3");
    expect(result).toEqual({
      color: DEFAULT_GRAPH_APPEARANCE.nodes?.component?.color,
      radius: DEFAULT_GRAPH_APPEARANCE.nodes?.component?.radius,
    });
  });
});
