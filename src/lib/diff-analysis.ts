import type { DatabaseData } from "@nexiq/shared";

export function createEmptyDatabaseData(): DatabaseData {
  return {
    packages: [],
    package_dependencies: [],
    files: [],
    entities: [],
    scopes: [],
    symbols: [],
    renders: [],
    exports: [],
    relations: [],
  };
}

export function analyzeDatabaseDiff(
  dataA: DatabaseData,
  dataB: DatabaseData,
): DatabaseData {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  const mapA = new Map(dataA.entities.map((entity) => [entity.id, entity]));
  const mapB = new Map(dataB.entities.map((entity) => [entity.id, entity]));

  for (const [id, entityB] of mapB.entries()) {
    if (!mapA.has(id)) {
      added.push(id);
      continue;
    }

    const entityA = mapA.get(id);
    if (entityA && entityA.data_json !== entityB.data_json) {
      modified.push(id);
    }
  }

  for (const id of mapA.keys()) {
    if (!mapB.has(id)) {
      deleted.push(id);
    }
  }

  return {
    ...dataB,
    diff: {
      added,
      modified,
      deleted,
    },
  };
}
