import React from "react";
import type { DetailSectionProps } from "@nexiq/extension-sdk";
import { TypeRenderer } from "../type-renderer";
import { TypeRefRenderer } from "../type-ref-renderer";
import {
  type PropData,
  type TypeDataParam,
} from "@nexiq/shared";
import { useConfigStore } from "@/hooks/use-config-store";
import { cn } from "@/lib/utils";

export const PropsSection: React.FC<DetailSectionProps> = ({
  typeData,
  detail,
}) => {
  const { customColors } = useConfigStore();

  if (!detail) return null;

  const { propType, props, typeParams, extends: extendsList } = detail;

  const renderGenerics = (params?: TypeDataParam[]) => {
    const genericsStyle = customColors?.genericsColor
      ? { color: customColors.genericsColor }
      : {};
    const keywordStyle = customColors?.typeKeyword
      ? { color: customColors.typeKeyword }
      : {};

    if (!params || params.length === 0) return null;
    return (
      <span className="text-muted-foreground pr-1">
        {"<"}
        {params.map((p, i) => (
          <span key={i}>
            {i > 0 && ", "}
            <span
              style={genericsStyle}
              className={cn(!customColors?.genericsColor && "text-yellow-200")}
            >
              {p.name}
            </span>
            {p.constraint && (
              <>
                <span
                  style={keywordStyle}
                  className={cn(
                    !customColors?.typeKeyword && "text-purple-400",
                  )}
                >
                  {" "}
                  extends{" "}
                </span>
                <TypeRenderer type={p.constraint} typeData={typeData} />
              </>
            )}
            {p.default && (
              <>
                <span
                  style={keywordStyle}
                  className={cn(
                    !customColors?.typeKeyword && "text-purple-400",
                  )}
                >
                  {" "}
                  ={" "}
                </span>
                <TypeRenderer type={p.default} typeData={typeData} />
              </>
            )}
          </span>
        ))}
        {">"}
      </span>
    );
  };

  if (!propType && (!props || props.length === 0)) return null;

  return (
    <div className="text-xs font-mono bg-muted/50 p-3 rounded-md border border-border max-w-full overflow-x-auto text-start leading-relaxed shadow-inner">
      {renderGenerics(typeParams)}
      {extendsList && (
        <span
          style={
            customColors?.typeKeyword ? { color: customColors.typeKeyword } : {}
          }
          className={cn(!customColors?.typeKeyword && "text-purple-400")}
        >
          {"extends "}
          {extendsList.map((param: string, i: number) => {
            return (
              <React.Fragment key={i}>
                <TypeRefRenderer
                  key={i}
                  type={{
                    type: "ref",
                    refType: "named",
                    name: param,
                  }}
                  typeData={typeData}
                />
                {extendsList.length - 1 > i && (
                  <span className="text-gray-400">,</span>
                )}{" "}
              </React.Fragment>
            );
          })}
        </span>
      )}
      {propType ? (
        <TypeRenderer type={propType} typeData={typeData} />
      ) : (
        props?.map((p: PropData, i: number) => (
          <div
            key={i}
            className={cn(
              "flex justify-between py-0.5 border-b border-border/50 last:border-0",
              p.gitStatus === "deleted" &&
                "opacity-50 line-through bg-destructive/10",
              p.gitStatus === "added" && "bg-green-500/10",
              p.gitStatus === "modified" && "bg-amber-500/10",
            )}
          >
            <span
              className={cn(
                "text-primary",
                p.gitStatus === "deleted" && "text-destructive",
                p.gitStatus === "added" && "text-green-500",
                p.gitStatus === "modified" && "text-amber-500",
              )}
            >
              {p.kind === "spread" ? "..." : ""}
              {p.name}
            </span>
            <span className="text-muted-foreground italic">{p.type}</span>
          </div>
        ))
      )}
    </div>
  );
};
