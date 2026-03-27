import { type PackageRow } from "@nexiq/shared";
import {
  type GraphViewResult,
  type GraphViewTask,
  type TaskContext,
  getTaskData,
} from "@nexiq/extension-sdk";

export const packageTask: GraphViewTask = {
  id: "package-task",
  priority: 10,
  run: (result: GraphViewResult, context: TaskContext) => {
    const data = getTaskData(context);
    const packages = data.packages || [];
    const package_dependencies = data.package_dependencies || [];

    if (!packages.length && !package_dependencies.length) return result;

    const nodeIds = new Set(result.nodes.map((node) => node.id));
    const edgeIds = new Set(result.edges.map((edge) => edge.id));

    packages.forEach((pkg: PackageRow) => {
      if (!nodeIds.has(pkg.id)) {
        result.nodes.push({
          id: pkg.id,
          name: pkg.name,
          type: "package",
          projectPath: pkg.path,
          label: { text: pkg.id },
          color: "#4CAF50",
        });
        nodeIds.add(pkg.id);
      }
    });

    for (const dep of package_dependencies) {
      const targetId = `${dep.dependency_name}@${dep.dependency_version}`;
      const edgeId = `${dep.package_id}->${targetId}`;

      if (!nodeIds.has(targetId)) {
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

    return result;
  },
};
