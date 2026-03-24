import { type DatabaseData, type PackageRow } from "@nexiq/shared";
import { type GraphViewResult, type GraphViewTask } from "../types";
import { type GraphComboData, type GraphNodeData } from "../../graph/hook";

/**
 * Task that groups components and hooks by their directory and file structure.
 */
export const fileTask: GraphViewTask = {
  id: "file-view",
  priority: 10,
  run: (
    data: DatabaseData,
    result: GraphViewResult,
    batch?: Partial<DatabaseData>,
  ): GraphViewResult => {
    const combos: GraphComboData[] = [...result.combos];
    const nodes: GraphNodeData[] = [...result.nodes];

    const files = batch?.files || data.files;
    const symbols = batch?.symbols || data.symbols;
    const indexedData = data as DatabaseData & {
      __indexes?: {
        entityById: Map<string, (typeof data.entities)[number]>;
        scopeById: Map<string, (typeof data.scopes)[number]>;
        fileById: Map<number, (typeof data.files)[number]>;
        packageById: Map<string, PackageRow>;
      };
    };
    const indexes = indexedData.__indexes;
    const packageMap =
      indexes?.packageById ||
      new Map((data.packages || []).map((p) => [p.id, p]));
    const existingComboIds = new Set(combos.map((combo) => combo.id));
    const existingNodeIds = new Set(nodes.map((node) => node.id));

    const createdDirs = new Set<string>();
    const createdPackages = new Set<string>();
    combos.forEach((c) => {
      if (c.id.startsWith("dir:")) createdDirs.add(c.id.slice(4));
      if (c.id.startsWith("pkg:")) createdPackages.add(c.id.slice(4));
    });

    for (const file of files) {
      const filePath = file.path;
      const packageId = file.package_id;
      const pkg = packageId ? packageMap.get(packageId) : undefined;
      const packageComboId = packageId ? `pkg:${packageId}` : undefined;

      // Create package combo
      if (packageId && pkg && !createdPackages.has(packageId)) {
        combos.push({
          id: packageComboId!,
          label: { text: pkg.name },
          type: "normal",
          fileName: pkg.path,
          projectPath: pkg.path,
          name: {
            type: "identifier",
            name: pkg.name,
            id: packageComboId!,
            loc: { line: 0, column: 0 },
          },
        });
        createdPackages.add(packageId);
      }

      // Create folder combos
      const parts = filePath.split("/").filter(Boolean);
      let currentPath = "";

      // The last part is the file itself, we want to create combos for directories
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i]!;
        const parentPath = currentPath;
        currentPath = currentPath ? `${currentPath}/${part}` : `/${part}`;

        if (!createdDirs.has(currentPath)) {
          combos.push({
            id: `dir:${currentPath}`,
            label: { text: part },
            combo: parentPath ? `dir:${parentPath}` : packageComboId,
            type: "normal", // generic combo type
            fileName: currentPath,
            projectPath: pkg?.path,
            name: {
              type: "identifier",
              name: part,
              id: currentPath,
              loc: { line: 0, column: 0 },
            },
          });
          createdDirs.add(currentPath);
        }
      }

      // Create file combo
      const fileName = parts[parts.length - 1]!;
      const dirPath = parts.slice(0, -1).join("/");
      const fileId = `file:${filePath}`;

      if (!existingComboIds.has(fileId)) {
        combos.push({
          id: fileId,
          label: { text: fileName },
          combo: dirPath ? `dir:/${dirPath}` : packageComboId,
          type: "normal",
          fileName: filePath,
          pureFileName: filePath,
          projectPath: pkg?.path,
          name: {
            type: "identifier",
            name: fileName,
            id: fileId,
            loc: { line: 0, column: 0 },
          },
        });
        existingComboIds.add(fileId);
      }
    }

    // Add symbols (components and hooks) as nodes within the file combo
    for (const symbol of symbols) {
      if (existingNodeIds.has(symbol.id)) continue;

      const entity =
        indexes?.entityById.get(symbol.entity_id) ||
        data.entities.find((e) => e.id === symbol.entity_id);
      if (!entity || (entity.kind !== "component" && entity.kind !== "hook"))
        continue;

      const scope =
        indexes?.scopeById.get(symbol.scope_id) ||
        data.scopes.find((s) => s.id === symbol.scope_id);
      if (!scope) continue;

      const file =
        indexes?.fileById.get(scope.file_id) ||
        data.files.find((f) => f.id === scope.file_id);
      if (!file) continue;

      nodes.push({
        id: symbol.id,
        name: symbol.name,
        label: { text: symbol.name },
        combo: `file:${file.path}`,
        type: entity.kind,
        fileName: file.path,
        pureFileName: file.path,
        projectPath: file.package_id
          ? packageMap.get(file.package_id)?.path
          : undefined,
        loc: { line: entity.line || 0, column: entity.column || 0 },
        radius: 20,
      });
      existingNodeIds.add(symbol.id);
    }

    return {
      ...result,
      nodes,
      combos,
    };
  },
};
