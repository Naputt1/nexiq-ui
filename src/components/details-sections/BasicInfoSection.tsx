import React from "react";
import type { DetailSectionProps } from "@nexiq/extension-sdk";

export const BasicInfoSection: React.FC<DetailSectionProps> = ({ item, detail }) => {
  const componentType =
    detail?.componentType ||
    (typeof item.componentType === "string"
      ? item.componentType
      : item.type === "component"
        ? "Function"
        : null);

  const fileName = detail?.fileName || item.fileName;
  const declarationKind = detail?.declarationKind || item.declarationKind;
  const tag = detail?.tag || item.tag;

  return (
    <div className="space-y-1">
      <div className="flex gap-2 text-xs">
        <span className="font-semibold text-muted-foreground/80 min-w-12 text-start">
          ID:
        </span>
        <span className="truncate text-muted-foreground" title={item.id}>
          {item.id}
        </span>
      </div>

      {fileName && (
        <div className="flex gap-2 text-xs">
          <span className="font-semibold text-muted-foreground/80 min-w-12 text-start">
            File:
          </span>
          <span className="text-muted-foreground break-all text-start">
            {fileName}
          </span>
        </div>
      )}

      {declarationKind && (
        <div className="flex gap-2 text-xs">
          <span className="font-semibold text-muted-foreground/80 min-w-12 text-start">
            Kind:
          </span>
          <span className="text-muted-foreground">{declarationKind}</span>
        </div>
      )}

      {tag && (
        <div className="flex gap-2 text-xs">
          <span className="font-semibold text-muted-foreground/80 min-w-12 text-start">
            Tag:
          </span>
          <span className="text-muted-foreground">{tag}</span>
        </div>
      )}
      
      {componentType && (
        <div className="flex gap-2 text-xs">
          <span className="font-semibold text-muted-foreground/80 min-w-12 text-start">
            Type:
          </span>
          <span className="text-muted-foreground capitalize">
            {componentType}
          </span>
        </div>
      )}
    </div>
  );
};
