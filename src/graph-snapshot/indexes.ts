import type {
  EntityRow,
  FileRow,
  PackageDependencyRow,
  PackageRow,
  RelationRow,
  RenderRow,
  ScopeRow,
  SymbolRow,
} from "@nexiq/shared";
import type {
  GraphSnapshotData,
  GraphSnapshotIndexes,
  IndexedGraphSnapshotData,
} from "./types";

function groupBy<K, V>(items: V[], getKey: (item: V) => K): Map<K, V[]> {
  const map = new Map<K, V[]>();
  for (const item of items) {
    const key = getKey(item);
    const bucket = map.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      map.set(key, [item]);
    }
  }
  return map;
}

export function buildGraphSnapshotIndexes(
  data: GraphSnapshotData,
): GraphSnapshotIndexes {
  const entityById = new Map<string, EntityRow>(
    data.entities.map((entity) => [entity.id, entity]),
  );
  const scopeById = new Map<string, ScopeRow>(
    data.scopes.map((scope) => [scope.id, scope]),
  );
  const fileById = new Map<number, FileRow>(data.files.map((file) => [file.id, file]));
  const filePathById = new Map<number, string>(
    data.files.map((file) => [file.id, file.path]),
  );
  const scopeByEntityId = new Map<string, ScopeRow>();
  for (const scope of data.scopes) {
    if (scope.entity_id) {
      scopeByEntityId.set(scope.entity_id, scope);
    }
  }

  const symbolsByEntityId = groupBy<string, SymbolRow>(
    data.symbols,
    (symbol) => symbol.entity_id,
  );
  const rendersByParentEntityId = groupBy<string, RenderRow>(
    data.renders,
    (render) => render.parent_entity_id,
  );

  const relationsByNodeId = new Map<string, RelationRow[]>();
  for (const relation of data.relations) {
    const fromBucket = relationsByNodeId.get(relation.from_id);
    if (fromBucket) {
      fromBucket.push(relation);
    } else {
      relationsByNodeId.set(relation.from_id, [relation]);
    }

    if (relation.to_id !== relation.from_id) {
      const toBucket = relationsByNodeId.get(relation.to_id);
      if (toBucket) {
        toBucket.push(relation);
      } else {
        relationsByNodeId.set(relation.to_id, [relation]);
      }
    }
  }

  const packageById = new Map<string, PackageRow>(
    (data.packages ?? []).map((pkg) => [pkg.id, pkg]),
  );
  const packageDependenciesByPackageId = groupBy<string, PackageDependencyRow>(
    data.package_dependencies ?? [],
    (dependency) => dependency.package_id,
  );

  return {
    entityById,
    scopeById,
    fileById,
    filePathById,
    scopeByEntityId,
    symbolsByEntityId,
    rendersByParentEntityId,
    relationsByNodeId,
    packageById,
    packageDependenciesByPackageId,
  };
}

export function withGraphSnapshotIndexes(
  data: GraphSnapshotData,
): IndexedGraphSnapshotData {
  return {
    ...data,
    __indexes: buildGraphSnapshotIndexes(data),
  };
}
