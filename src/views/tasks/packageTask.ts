import { type DatabaseData } from "@nexiq/shared";
import type { GraphViewResult, GraphViewTask } from "../types";

export const packageTask: GraphViewTask = {
  id: "package-task",
  priority: 10,
  run: (data: DatabaseData, result: GraphViewResult) => {
    const rawData = data as any;
    if (!rawData.packages || !rawData.package_dependencies) return result;

    const { packages, package_dependencies } = rawData;
    const indexedPackages = rawData.__indexes?.packageById as
      | Map<string, { id: string; name: string }>
      | undefined;
    const depsByPackage = rawData.__indexes?.packageDependenciesByPackageId as
      | Map<string, typeof package_dependencies>
      | undefined;
    const nodeIds = new Set(result.nodes.map((node) => node.id));
    const edgeIds = new Set(result.edges.map((edge) => edge.id));

    const packageList =
      indexedPackages != null ? Array.from(indexedPackages.values()) : packages;

    packageList.forEach((pkg: any) => {
      // Create a node for the internal package
      if (!nodeIds.has(pkg.id)) {
        result.nodes.push({
          id: pkg.id,
          name: pkg.name,
          type: "package",
          label: { text: pkg.id },
          color: "#4CAF50",
        });
        nodeIds.add(pkg.id);
      }
    });

    const dependencyGroups =
      depsByPackage != null
        ? Array.from(depsByPackage.values())
        : packageList.map((pkg: any) =>
            package_dependencies.filter((dep: any) => dep.package_id === pkg.id),
          );

    for (const dependencies of dependencyGroups) {
      for (const dep of dependencies) {
        const targetId = `${dep.dependency_name}@${dep.dependency_version}`;
        const edgeId = `${dep.package_id}->${targetId}`;
        const isInternal = nodeIds.has(targetId);

        if (!isInternal && !nodeIds.has(targetId)) {
          result.nodes.push({
            id: targetId,
            name: dep.dependency_name,
            type: "external-package",
            label: { text: targetId },
            color: "#9E9E9E",
          });
          nodeIds.add(targetId);
        }

        if (!edgeIds.has(edgeId)) {
          result.edges.push({
            id: edgeId,
            source: dep.package_id,
            target: targetId,
            label: dep.is_dev ? "dev" : "prod",
          });
          edgeIds.add(edgeId);
        }
      }
    }

    return result;
  },
};
