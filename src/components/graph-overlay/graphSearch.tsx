import type { PixiRenderer } from "@/graph/pixiRenderer";
import { useAppStateStore } from "@/hooks/use-app-state-store";
import { useGraphStore } from "@/hooks/use-graph-store";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useCallback, useEffect, useRef, useState } from "react";

type GraphSearchProps = {
  rendererRef: React.RefObject<PixiRenderer | null>;
};

const GraphSearch: React.FC<GraphSearchProps> = ({ rendererRef }) => {
  const selectedId = useAppStateStore((s) => s.selectedId);
  const searchIsOpen = useAppStateStore((s) => s.search.isOpen);
  const searchValue = useAppStateStore((s) => s.search.value);
  const setIsSearchOpen = useAppStateStore((s) => s.setIsSearchOpen);
  const setSearchValue = useAppStateStore((s) => s.setSearchValue);

  const setSelectedId = useAppStateStore((s) => s.setSelectedId);

  const graph = useGraphStore((s) => s.graphInstance);

  const [debouncedSearch, setDebouncedSearch] = useState<string>("");

  const [matches, setMatches] = useState<string[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);

  const searchInputRef = useRef<HTMLInputElement>(null);

  const goToNextMatch = useCallback(() => {
    if (matches.length === 0) return;
    const nextIndex = (currentMatchIndex + 1) % matches.length;
    setCurrentMatchIndex(nextIndex);
    graph.expandAncestors(matches[nextIndex]);
    rendererRef.current?.focusItem(matches[nextIndex], 1.5);
    setSelectedId(matches[nextIndex]);
  }, [matches, currentMatchIndex, graph, rendererRef, setSelectedId]);

  const goToPrevMatch = useCallback(() => {
    if (matches.length === 0) return;
    const prevIndex = (currentMatchIndex - 1 + matches.length) % matches.length;
    setCurrentMatchIndex(prevIndex);
    graph.expandAncestors(matches[prevIndex]);
    rendererRef.current?.focusItem(matches[prevIndex], 1.5);
    setSelectedId(matches[prevIndex]);
  }, [matches, currentMatchIndex, graph, rendererRef, setSelectedId]);

  useHotkey("Control+F", () => {
    if (searchIsOpen) {
      searchInputRef.current?.select();
    } else {
      setIsSearchOpen(true);
    }
  });

  useHotkey("Enter", () => {
    if (searchIsOpen) {
      goToNextMatch();
    } else if (selectedId) {
      graph.focusItem(selectedId);
    }
  });

  useHotkey("Shift+Enter", () => {
    if (searchIsOpen) {
      goToPrevMatch();
    } else if (selectedId) {
      graph.focusItem(null);
    }
  });

  useHotkey("Escape", () => {
    setIsSearchOpen(false);
  });

  const resetHighlights = useCallback(() => {
    const combos = graph.getAllCombos();
    for (const combo of Object.values(combos)) {
      if (combo.highlighted) {
        combo.highlighted = false;
        graph.updateCombo(combo);
      }
    }
    const nodes = graph.getAllNodes();
    for (const node of Object.values(nodes)) {
      if (node.highlighted) {
        node.highlighted = false;
        graph.updateNode(node);
      }
    }
    const edges = graph.getAllEdges();
    for (const edge of Object.values(edges)) {
      if (edge.highlighted || edge.dimmed || edge.flowRole) {
        edge.highlighted = false;
        edge.dimmed = false;
        edge.flowRole = null;
      }
    }
    graph.refresh(true);
  }, [graph]);

  const performSearch = useCallback(
    (value: string) => {
      let firstMatchId: string | null = null;
      const newMatches: string[] = [];

      graph.batch(() => {
        if (value === "") {
          setMatches([]);
          setCurrentMatchIndex(-1);
          resetHighlights();
          return;
        }

        const lowerValue = value.toLowerCase();

        const combos = graph.getAllCombos();
        for (const combo of combos) {
          if (combo.id.endsWith("-render")) continue;

          const text = (
            combo.displayName || String(combo.name || "")
          ).toLowerCase();
          const isMatch = text.includes(lowerValue);
          if (isMatch) {
            if (!combo.highlighted) {
              combo.highlighted = true;
              graph.updateCombo(combo);
            }
            newMatches.push(combo.id);
          } else if (combo.highlighted) {
            combo.highlighted = false;
            graph.updateCombo(combo);
          }
        }

        const nodes = graph.getAllNodes();
        for (const node of nodes) {
          const text = (
            node.displayName || String(node.name || "")
          ).toLowerCase();
          const isMatch = text.includes(lowerValue);
          if (isMatch) {
            if (!node.highlighted) {
              node.highlighted = true;
              graph.updateNode(node);
            }
            newMatches.push(node.id);
          } else if (node.highlighted) {
            node.highlighted = false;
            graph.updateNode(node);
          }
        }

        if (newMatches.length > 0) {
          firstMatchId = newMatches[0];
        }
      });

      setMatches(newMatches);
      if (newMatches.length > 0) {
        setCurrentMatchIndex(0);
        setSelectedId(firstMatchId);
        // Small timeout to allow the batch render to complete before starting expansion animations
        setTimeout(() => {
          if (firstMatchId) {
            graph.expandAncestors(firstMatchId);
            rendererRef.current?.focusItem(firstMatchId, 1.5);
          }
        }, 50);
      } else {
        setCurrentMatchIndex(-1);
      }
    },
    [graph, rendererRef, resetHighlights, setSelectedId],
  );

  // Clear search and highlights when search bar is closed
  useEffect(() => {
    if (!searchIsOpen) {
      setSearchValue("");
      setDebouncedSearch("");
      setMatches([]);
      setCurrentMatchIndex(-1);
      resetHighlights();
    }
  }, [searchIsOpen, resetHighlights, setSearchValue]);

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchValue);
    }, 200);
    return () => clearTimeout(handler);
  }, [searchValue]);

  // Trigger search when debounced value changes
  useEffect(() => {
    performSearch(debouncedSearch);
  }, [debouncedSearch, performSearch]);

  // Focus and select search input when opened
  useEffect(() => {
    if (searchIsOpen) {
      // Small delay to ensure the input is rendered and focused
      setTimeout(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }, 10);
    }
  }, [searchIsOpen]);

  if (!searchIsOpen) return undefined;

  return (
    <div className="absolute bottom-17.5 right-4 z-20 flex items-center rounded border border-border bg-popover p-1 shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="flex items-center gap-1">
        <div className="relative flex items-center">
          <input
            ref={searchInputRef}
            autoFocus
            type="text"
            value={searchValue}
            placeholder="Find"
            onChange={(e) => setSearchValue(e.target.value)}
            className="bg-muted text-foreground pl-2 pr-16 py-1 outline-none text-sm w-64 border border-transparent focus:border-primary rounded-sm placeholder:text-muted-foreground"
          />
          <div className="absolute right-2 text-[11px] text-muted-foreground pointer-events-none">
            {matches.length > 0 ? (
              <span className="text-foreground">
                {currentMatchIndex + 1} of {matches.length}
              </span>
            ) : searchValue !== "" ? (
              <span className="text-destructive">No results</span>
            ) : null}
          </div>
        </div>

        <div className="flex items-center border-l border-border pl-1 gap-1">
          <button
            onClick={goToPrevMatch}
            className="p-1 hover:bg-accent hover:text-accent-foreground rounded-sm text-muted-foreground transition-colors"
            title="Previous Match (Shift+Enter)"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M7.707 5.293a1 1 0 0 1 1.414 0l4 4a1 1 0 0 1-1.414 1.414L8 7.414l-3.707 3.707a1 1 0 0 1-1.414-1.414l4-4z" />
            </svg>
          </button>
          <button
            onClick={goToNextMatch}
            className="p-1 hover:bg-accent hover:text-accent-foreground rounded-sm text-muted-foreground transition-colors"
            title="Next Match (Enter)"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M7.707 10.707a1 1 0 0 0 1.414 0l4-4a1 1 0 0 0-1.414-1.414L8 8.586l-3.707-3.707a1 1 0 0 0-1.414 1.414l4 4z" />
            </svg>
          </button>
          <button
            onClick={() => setIsSearchOpen(false)}
            className="p-1 hover:bg-accent hover:text-accent-foreground rounded-sm text-muted-foreground transition-colors ml-1"
            title="Close (Esc)"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1.293 1.293a1 1 0 0 1 1.414 0L8 6.586l5.293-5.293a1 1 0 1 1 1.414 1.414L9.414 8l5.293 5.293a1 1 0 0 1-1.414 1.414L8 9.414l-5.293 5.293a1 1 0 0 1-1.414-1.414L8 9.414l-5.293 5.293a1 1 0 0 1-1.414-1.414L6.586 8 1.293 2.707a1 1 0 0 1 0-1.414z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default GraphSearch;
