import React from "react";
import type { DetailSectionProps } from "@nexiq/extension-sdk";
import {
  getDisplayName,
  type ComponentInfoRenderDependency,
  type ComponentInfoRender,
} from "@nexiq/shared";
import { TypeRenderer } from "../type-renderer";
import { useConfigStore } from "@/hooks/use-config-store";
import { cn } from "@/lib/utils";
import { type GraphNodeData } from "@/graph/hook";

export const ChildrenSection: React.FC<DetailSectionProps> = ({
  item: baseItem,
  selectedId,
  typeData,
  detail,
  renderNodes = [],
}) => {
  const { customColors } = useConfigStore();
  const item = baseItem as GraphNodeData;
  const children = (detail?.raw &&
  typeof detail.raw === "object" &&
  "children" in detail.raw
    ? (detail.raw as { children: Record<string, ComponentInfoRender> }).children
    : (item as { children?: Record<string, ComponentInfoRender> })
        .children) as Record<string, ComponentInfoRender> | undefined;

  if (!item.hasChildren || !children || Object.keys(children).length === 0) return null;

  return (
    <div className="space-y-4">
      {renderNodes.map((v: GraphNodeData) => {
        const renderId = v.id.slice((selectedId! + "-render-").length);
        const render = children?.[renderId];

        if (!render) return null;

        return (
          <div
            key={v.id}
            className="text-xs font-mono bg-muted/30 p-2 rounded border border-border/50"
          >
            <div className="font-bold text-primary mb-1 text-start">
              {getDisplayName(v.name)}
            </div>

            <div className="space-y-1">
              {render.dependencies.map(
                (dep: ComponentInfoRenderDependency, i: number) => (
                  <div key={i} className="flex gap-2">
                    <span
                      style={
                        customColors?.genericsColor
                          ? {
                              color: customColors.genericsColor,
                              opacity: 0.8,
                            }
                          : {}
                      }
                      className={cn(
                        !customColors?.genericsColor && "text-yellow-200/80",
                      )}
                    >
                      {dep.name}:
                    </span>

                    <span className="text-muted-foreground italic text-start">
                      <TypeRenderer type={dep.value} typeData={typeData} />
                    </span>
                  </div>
                ),
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
