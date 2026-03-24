import type { GraphViewResult } from "../views/types";

function isPlainObject(value: unknown) {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateSerializable(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
): void {
  if (
    value == null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validateSerializable(item, `${path}[${index}]`, seen),
    );
    return;
  }

  if (typeof value !== "object") {
    throw new Error(`View result contains non-serializable value at ${path}`);
  }

  if (seen.has(value)) {
    throw new Error(`View result contains circular data at ${path}`);
  }
  seen.add(value);

  if (!isPlainObject(value)) {
    throw new Error(
      `View result contains unsupported object type at ${path || "<root>"}`,
    );
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    validateSerializable(nestedValue, path ? `${path}.${key}` : key, seen);
  }
}

export function encodeGraphViewSnapshot(result: GraphViewResult): Uint8Array {
  validateSerializable(result, "", new WeakSet());
  return new TextEncoder().encode(JSON.stringify(result));
}

export function decodeGraphViewSnapshot(data: Uint8Array): GraphViewResult {
  return JSON.parse(new TextDecoder().decode(data)) as GraphViewResult;
}
