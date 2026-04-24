import { describe, it, expect, beforeAll } from "vitest";
import init, { ForceLayout } from "@nexiq/layout-wasm";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("ForceLayout WASM", () => {
  beforeAll(async () => {
    const wasmPath = join(__dirname, "../../node_modules/@nexiq/layout-wasm/pkg/nexiq_layout_wasm_bg.wasm");
    const wasmBuffer = readFileSync(wasmPath);
    await init(wasmBuffer);
  });

  it("should converge to a stable state", () => {
    const positions = new Float32Array([0, 0, 10, 10, -10, -10]);
    const radii = new Float32Array([20, 20, 20]);
    const fixed = new Uint8Array([0, 0, 0]);
    const sources = new Uint32Array([0, 1, 2]);
    const targets = new Uint32Array([1, 2, 0]);
    
    const opts = {
      repulsionStrength: 1000,
      linkDistance: 80,
      gravity: 0.5,
      alpha: 1.0,
      alphaDecay: 0.02,
      theta: 0.5,
      damping: 0.9,
      timeStep: 0.016,
      maxDisplacement: 100,
      collisionStrength: 0.5,
      minNodeDistance: 0,
      nodeRadius: 0,
    };

    const layout = new ForceLayout(
      positions,
      radii,
      fixed,
      sources,
      targets,
      opts
    );

    layout.run_steps(500);

    const result = new Float32Array(6);
    layout.get_positions(result);

    for (let i = 0; i < 6; i++) {
      expect(result[i]).not.toBeNaN();
      expect(Math.abs(result[i])).toBeLessThan(500);
    }
  });
});
