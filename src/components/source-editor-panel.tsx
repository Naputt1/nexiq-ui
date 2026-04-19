import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertTriangle, ChevronRight, ExternalLink, X } from "lucide-react";
import type {
  FileAnalysisErrorRow,
  ResolveErrorRow,
} from "../../electron/types";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";
import { useAppStateStore } from "@/hooks/use-app-state-store";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface SourceNodeMarker {
  id: string;
  label: string;
  line: number;
}

interface TokenPart {
  text: string;
  className?: string;
}

interface ErrorEntry {
  id: string;
  filePath: string;
  relativePath: string;
  line?: number | null;
  column?: number | null;
  title: string;
  message: string;
  kind: "file" | "resolve";
}

const KEYWORDS = new Set([
  "import",
  "from",
  "export",
  "default",
  "function",
  "return",
  "const",
  "let",
  "var",
  "class",
  "extends",
  "if",
  "else",
  "switch",
  "case",
  "for",
  "while",
  "try",
  "catch",
  "finally",
  "await",
  "async",
  "new",
  "type",
  "interface",
  "enum",
  "as",
  "implements",
  "useState",
  "useEffect",
]);

const MARKER_TONES = [
  {
    line: "border-l-sky-500/60 bg-sky-500/10",
    badge: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-200",
  },
  {
    line: "border-l-emerald-500/60 bg-emerald-500/10",
    badge:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200",
  },
  {
    line: "border-l-amber-500/60 bg-amber-500/10",
    badge:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200",
  },
  {
    line: "border-l-rose-500/60 bg-rose-500/10",
    badge: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200",
  },
  {
    line: "border-l-violet-500/60 bg-violet-500/10",
    badge:
      "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-200",
  },
  {
    line: "border-l-cyan-500/60 bg-cyan-500/10",
    badge: "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200",
  },
];

const TOKEN_CACHE = new Map<string, TokenPart[]>();

function hashIndex(input: string, max: number) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % max;
}

function getMarkerTone(id: string) {
  return MARKER_TONES[hashIndex(id, MARKER_TONES.length)];
}

function detectLanguage(filePath: string | null) {
  if (!filePath) return "text";
  if (filePath.endsWith(".tsx")) return "tsx";
  if (filePath.endsWith(".ts")) return "ts";
  if (filePath.endsWith(".jsx")) return "jsx";
  if (filePath.endsWith(".js")) return "js";
  if (filePath.endsWith(".json")) return "json";
  return "text";
}

function getRelativePath(filePath: string | null, projectPath: string) {
  if (!filePath) return null;
  const normalizedProject = projectPath.replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedFile = filePath.replace(/\\/g, "/");
  if (normalizedFile.startsWith(`${normalizedProject}/`)) {
    return normalizedFile.slice(normalizedProject.length + 1);
  }
  return normalizedFile;
}

function getFileBadge(language: string) {
  switch (language) {
    case "tsx":
      return "TSX";
    case "ts":
      return "TS";
    case "jsx":
      return "JSX";
    case "js":
      return "JS";
    case "json":
      return "JSON";
    default:
      return "TXT";
  }
}

function tokenizeLine(line: string) {
  const cached = TOKEN_CACHE.get(line);
  if (cached) {
    return cached;
  }

  const regex =
    /(\/\/.*$|\/\*[\s\S]*?\*\/|"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|`(?:\\.|[^`])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b|[()[\]{}<>.,:;=+\-*/!?&|]+)/g;
  const parts: TokenPart[] = [];
  let lastIndex = 0;

  for (const match of line.matchAll(regex)) {
    const text = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push({ text: line.slice(lastIndex, index) });
    }

    let className: string | undefined;
    if (text.startsWith("//") || text.startsWith("/*")) {
      className = "text-emerald-600 dark:text-emerald-300";
    } else if (
      text.startsWith('"') ||
      text.startsWith("'") ||
      text.startsWith("`")
    ) {
      className = "text-amber-600 dark:text-amber-300";
    } else if (/^\d/.test(text)) {
      className = "text-sky-600 dark:text-sky-300";
    } else if (KEYWORDS.has(text)) {
      className = "text-violet-600 dark:text-violet-300";
    } else if (/^[()[\]{}<>.,:;=+\-*/!?&|]+$/.test(text)) {
      className = "text-muted-foreground";
    } else if (/^[A-Z]/.test(text)) {
      className = "text-cyan-700 dark:text-cyan-200";
    } else {
      className = "text-foreground";
    }

    parts.push({ text, className });
    lastIndex = index + text.length;
  }

  if (lastIndex < line.length) {
    parts.push({ text: line.slice(lastIndex) });
  }

  if (parts.length === 0) {
    parts.push({ text: line });
  }

  TOKEN_CACHE.set(line, parts);
  return parts;
}

type TabsTriggerProps = {
  fileBadge: string;
  relativePath: string | null;
  totalErrors: number;
  filePath: string | null;
  onOpenFile: () => void;
  onClose: () => void;
};

const SourcePanelHeader = React.memo(function SourcePanelHeader({
  fileBadge,
  relativePath,
  totalErrors,
  filePath,
  onOpenFile,
  onClose,
}: TabsTriggerProps) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-4 px-4 pt-3 pb-1">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-md border bg-muted text-[11px] font-semibold tracking-wide text-muted-foreground">
          {fileBadge}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">
            {relativePath ?? "No file selected"}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <TabsList className="bg-muted/40">
          <TabsTrigger value="source">Source</TabsTrigger>
          <TabsTrigger value="errors" className="gap-1">
            <AlertTriangle className="h-3.5 w-3.5" />
            Errors
            {totalErrors > 0 && (
              <Badge variant="secondary" className="ml-1">
                {totalErrors}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <Button
          variant="outline"
          size="sm"
          onClick={onOpenFile}
          disabled={!filePath}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open file
        </Button>

        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
});

const SourceLineRow = React.memo(function SourceLineRow({
  line,
  lineNumber,
  selectedNodeId,
  markersForLine,
  onSelectNode,
}: {
  line: string;
  lineNumber: number;
  selectedNodeId: string | null;
  markersForLine: SourceNodeMarker[];
  onSelectNode: (id: string) => void;
}) {
  // Pick active marker only once
  const activeMarker = useMemo(
    () =>
      markersForLine.find((marker) => marker.id === selectedNodeId) ??
      markersForLine[0],
    [markersForLine, selectedNodeId],
  );

  // Get tone only if active marker changes
  const tone = useMemo(
    () => (activeMarker ? getMarkerTone(activeMarker.id) : null),
    [activeMarker],
  );

  // Tokenize line only if line changes
  const parts = useMemo(() => tokenizeLine(line), [line]);

  // Avoid inline map in render for markers buttons
  const markerButtons = useMemo(
    () =>
      markersForLine.map((marker) => (
        <button
          key={marker.id}
          type="button"
          onClick={() => onSelectNode(marker.id)}
          title="Focus linked node"
          className={cn(
            "h-4 rounded-full border px-1.5 text-[9px] font-medium transition-colors leading-none",
            getMarkerTone(marker.id).badge,
          )}
        >
          {marker.label}
        </button>
      )),
    [markersForLine, onSelectNode],
  );

  const renderedParts = useMemo(
    () =>
      parts.map((part, idx) => (
        <span key={idx} className={part.className}>
          {part.text}
        </span>
      )),
    [parts],
  );

  return (
    <div
      className={cn(
        "group grid min-w-max grid-cols-[64px_1fr] gap-0 px-3 border-l-2 border-l-transparent",
        tone?.line,
      )}
    >
      <div className="select-none pr-4 text-right text-muted-foreground">
        {lineNumber}
      </div>
      <div className="min-w-0 relative">
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 whitespace-pre text-left">
            {renderedParts}
            {line.length === 0 ? " " : ""}
          </code>

          {markersForLine.length > 0 && (
            <div className="absolute inset-0 flex items-center justify-end pointer-events-none">
              <div className="hidden shrink-0 items-center gap-1 group-hover:flex pointer-events-auto backdrop-blur-sm px-2 py-0.5 rounded-full shadow-sm border border-border/50">
                {markerButtons}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

type SourceViewportProps = {
  content: string;
  markers: SourceNodeMarker[];
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
};

const SourceViewport: React.FC<SourceViewportProps> = React.memo(
  ({ content, markers, selectedNodeId, onSelectNode }) => {
    const parentRef = useRef<HTMLDivElement>(null);

    // Split lines only when content changes
    const lines = useMemo(() => content.split("\n"), [content]);

    // Map markers by line once
    const markerMap = useMemo(() => {
      const map = new Map<number, SourceNodeMarker[]>();
      for (const marker of markers) {
        map.set(marker.line, [...(map.get(marker.line) ?? []), marker]);
      }
      return map;
    }, [markers]);

    // Virtualizer setup
    const rowVirtualizer = useVirtualizer({
      count: lines.length,
      getScrollElement: () => parentRef.current,
      estimateSize: () => 24,
      overscan: 16,
    });

    // Scroll to selected node line
    useEffect(() => {
      if (selectedNodeId) {
        const marker = markers.find((m) => m.id === selectedNodeId);
        if (marker) {
          rowVirtualizer.scrollToIndex(marker.line - 1, { align: "center" });
        }
      }
    }, [selectedNodeId, markers, rowVirtualizer]);

    const virtualItems = rowVirtualizer.getVirtualItems();

    return (
      <CardContent className="min-h-0 flex-1 flex overflow-hidden p-0">
        <div ref={parentRef} className="flex-1 overflow-auto">
          <div
            className="relative min-w-max px-0 py-3 font-mono text-[12.5px] leading-6"
            style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
          >
            {virtualItems.map((virtualItem) => {
              const lineIndex = virtualItem.index;
              const lineNumber = lineIndex + 1;
              const markersForLine = markerMap.get(lineNumber) ?? [];

              return (
                <div
                  key={lineNumber}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${virtualItem.start}px)` }}
                >
                  <SourceLineRow
                    line={lines[lineIndex]}
                    lineNumber={lineNumber}
                    selectedNodeId={selectedNodeId}
                    markersForLine={markersForLine}
                    onSelectNode={onSelectNode}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    );
  },
);

type IOnOpenError = (filePath: string, line?: number, column?: number) => void;

type ErrorListItemProps = {
  relativePath: string;
  errors: ErrorEntry[];
  onOpenError: IOnOpenError;
} & { ref?: React.Ref<HTMLDivElement> };

const ErrorListItem: React.FC<ErrorListItemProps> = React.memo(
  ({ relativePath, errors, onOpenError, ref }) => {
    return (
      <Card key={relativePath} className="shadow-none" ref={ref}>
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{relativePath}</div>
            </div>
            <Badge variant="outline">{errors.length}</Badge>
          </div>
          <div className="divide-y">
            {errors.map((error) => (
              <button
                key={error.id}
                type="button"
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/40"
                onClick={() =>
                  onOpenError(
                    error.filePath,
                    error.line ?? undefined,
                    error.column ?? undefined,
                  )
                }
              >
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-muted">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{error.title}</span>
                    <Badge variant="secondary">{error.kind}</Badge>
                    {error.line ? (
                      <Badge variant="outline">
                        L{error.line}
                        {error.column ? `:${error.column}` : ""}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 break-words text-sm text-muted-foreground">
                    {error.message}
                  </p>
                </div>
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  },
);

type ErrorListProps = {
  projectPath: string;
  fileErrors: FileAnalysisErrorRow[];
  resolveErrors: ResolveErrorRow[];
  filePath: string | null;
};

const ErrorList: React.FC<ErrorListProps> = React.memo(function ErrorList({
  projectPath,
  fileErrors,
  resolveErrors,
  filePath,
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const onOpenError = useCallback(
    (filePath: string, line?: number, column?: number) => {
      void window.ipcRenderer.invoke(
        "open-vscode",
        filePath,
        projectPath,
        line,
        column,
      );
    },
    [projectPath],
  );

  const groupedErrors = useMemo(() => {
    const allErrors: ErrorEntry[] = [
      ...fileErrors.map((error) => ({
        id: error.id,
        filePath: error.file_path,
        relativePath:
          getRelativePath(error.file_path, projectPath) ?? error.file_path,
        line: error.line,
        column: error.column,
        title: error.error_code || error.stage,
        message: error.message,
        kind: "file" as const,
      })),
      ...resolveErrors.map((error) => ({
        id: error.id,
        filePath: error.file_path,
        relativePath:
          getRelativePath(error.file_path, projectPath) ?? error.file_path,
        line: error.loc_line,
        column: error.loc_column,
        title: error.relation_kind,
        message: error.message,
        kind: "resolve" as const,
      })),
    ];

    const groupErrors = Object.entries(
      allErrors.reduce<Record<string, ErrorEntry[]>>((groups, error) => {
        groups[error.relativePath] ??= [];
        groups[error.relativePath].push(error);
        return groups;
      }, {}),
    );

    return groupErrors.map(([relativePath, errors]) => (
      <ErrorListItem
        key={relativePath}
        relativePath={relativePath}
        errors={errors}
        onOpenError={onOpenError}
        ref={(el) => {
          itemRefs.current[relativePath] = el;
        }}
      />
    ));
  }, [fileErrors, resolveErrors, projectPath, onOpenError]);

  useEffect(() => {
    if (filePath && containerRef.current) {
      const relativePath = getRelativePath(filePath, projectPath);

      if (relativePath) {
        const el = itemRefs.current["/" + relativePath];
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
    }
  }, [filePath, projectPath]);

  return (
    <CardContent
      ref={containerRef}
      className="min-h-0 flex-1 overflow-auto p-4"
    >
      {groupedErrors.length === 0 ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="p-6 text-sm text-muted-foreground">
            No analysis errors were found for the current selection.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">{...groupedErrors}</div>
      )}
    </CardContent>
  );
});
interface SourceEditorPanelProps {
  filePath: string | null;
  projectPath: string;
  content: string;
  selectedNodeId: string | null;
  markers: SourceNodeMarker[];
  fileErrors: FileAnalysisErrorRow[];
  resolveErrors: ResolveErrorRow[];
  isOpen: boolean;
  onSelectNode: (id: string) => void;
  onOpenFile: () => void;
  onClose: () => void;
}

export const SourceEditorPanel = React.memo(function SourceEditorPanel({
  filePath,
  projectPath,
  content,
  selectedNodeId,
  markers,
  fileErrors,
  resolveErrors,
  isOpen,
  onSelectNode,
  onOpenFile,
  onClose,
}: SourceEditorPanelProps) {
  const [uncontrolledTab, setUncontrolledTab] = useState<"source" | "errors">(
    "source",
  );
  const [, startTransition] = useTransition();

  const bottomPanelTab = useAppStateStore((s) => s.sidebar.bottom.activeTab);
  const setBottomPanelTab = useAppStateStore((s) => s.setBottomPanelTab);

  const activeTab = bottomPanelTab ?? uncontrolledTab;

  const language = detectLanguage(filePath);
  const relativePath = getRelativePath(filePath, projectPath);
  const fileBadge = getFileBadge(language);
  const totalErrors = fileErrors.length + resolveErrors.length;

  const setActiveTab = (tab: "source" | "errors") => {
    startTransition(() => {
      if (bottomPanelTab === undefined) {
        setUncontrolledTab(tab);
      }
      setBottomPanelTab(tab);
    });
  };

  if (!isOpen) return null;

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden rounded-none border-x-0 border-b-0 shadow-none">
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "source" | "errors")}
        defaultValue="source"
        className="flex flex-col flex-1 min-h-0"
      >
        <SourcePanelHeader
          fileBadge={fileBadge}
          relativePath={relativePath}
          totalErrors={totalErrors}
          filePath={filePath}
          onOpenFile={onOpenFile}
          onClose={onClose}
        />

        <Separator />

        <TabsContent
          value="source"
          forceMount
          className="flex-1 min-h-0 flex flex-col"
        >
          <SourceViewport
            content={content}
            markers={markers}
            selectedNodeId={selectedNodeId}
            onSelectNode={onSelectNode}
          />
        </TabsContent>

        <TabsContent
          value="errors"
          forceMount
          className="flex-1 min-h-0 overflow-auto"
        >
          <ErrorList
            projectPath={projectPath}
            fileErrors={fileErrors}
            resolveErrors={resolveErrors}
            filePath={filePath}
          />
        </TabsContent>
      </Tabs>
    </Card>
  );
});
