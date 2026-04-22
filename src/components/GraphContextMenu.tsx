import React, { useState, useImperativeHandle, forwardRef } from "react";
import { Search, RefreshCw } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { Kbd } from "./ui/kbd";
import { GraphData } from "@/graph/hook";
import { PixiRenderer } from "@/graph/pixiRenderer";

interface GraphContextMenuProps {
  graph: GraphData;
  rendererRef: React.RefObject<PixiRenderer | null>;
  modLabel: string;
  children: React.ReactNode;
}

export interface GraphContextMenuHandle {
  open: (id: string | null, x: number, y: number) => void;
}

export const GraphContextMenu = forwardRef<
  GraphContextMenuHandle,
  GraphContextMenuProps
>(({ graph, rendererRef, modLabel, children }, ref) => {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    targetId: string | null;
  } | null>(null);

  const triggerRef = React.useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    open: (targetId, x, y) => {
      setContextMenu({ x, y, targetId });
      // Trigger a native contextmenu event on the trigger to open Radix UI's ContextMenu
      const event = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 2,
      });
      triggerRef.current?.dispatchEvent(event);
    },
  }));

  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (!open) setContextMenu(null);
      }}
    >
      <ContextMenuTrigger
        asChild
        onContextMenu={(e) => {
          const targetId =
            rendererRef.current?.getItemAt(e.clientX, e.clientY) || null;
          setContextMenu({
            x: e.clientX,
            y: e.clientY,
            targetId,
          });
        }}
      >
        <div ref={triggerRef}>{children}</div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-64">
        {contextMenu?.targetId ? (
          <>
            <ContextMenuItem
              onClick={() => {
                graph.focusItem(contextMenu.targetId);
              }}
            >
              <Search className="mr-2 h-4 w-4" />
              Focus this Item
              <ContextMenuShortcut>
                <Kbd className="bg-transparent border-0 p-0 text-inherit">
                  {modLabel}
                </Kbd>
                <Kbd className="bg-transparent border-0 p-0 text-inherit">
                  Enter
                </Kbd>
              </ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        ) : null}
        {graph.getFocusedId() && (
          <ContextMenuItem
            onClick={() => {
              graph.focusItem(null);
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Reset Focus
            <ContextMenuShortcut>
              <Kbd className="bg-transparent border-0 p-0 text-inherit">
                {modLabel}
              </Kbd>
              <Kbd className="bg-transparent border-0 p-0 text-inherit">⇧</Kbd>
              <Kbd className="bg-transparent border-0 p-0 text-inherit">
                Enter
              </Kbd>
            </ContextMenuShortcut>
          </ContextMenuItem>
        )}
        <ContextMenuItem
          onClick={() => {
            graph.layout(true);
          }}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Recalculate Layout
          <ContextMenuShortcut>
            <Kbd className="bg-transparent border-0 p-0 text-inherit">
              {modLabel}
            </Kbd>
            <Kbd className="bg-transparent border-0 p-0 text-inherit">L</Kbd>
          </ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});
