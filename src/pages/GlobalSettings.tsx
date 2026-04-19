import { useState, useEffect, useMemo } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, CheckCircle2 } from "lucide-react";
import type { GraphAppearance } from "../../electron/types";
import { Input } from "@/components/ui/input";
import { normalizeGraphAppearance } from "@nexiq/extension-sdk";
import debounce from "lodash.debounce";

interface GlobalSettingsProps {
  projectPath?: string;
}

export function GlobalSettings({
  projectPath: _projectPath,
}: GlobalSettingsProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [appTheme, setAppTheme] = useState<"dark" | "light">("dark");
  const [autoReload, setAutoReload] = useState<boolean>(true);
  const [appearance, setAppearance] = useState<GraphAppearance>(
    normalizeGraphAppearance(),
  );

  useEffect(() => {
    const fetchGlobalConfig = async () => {
      try {
        const globalConfig =
          await window.ipcRenderer.invoke("get-global-config");
        if (globalConfig) {
          setAppTheme(globalConfig.theme);
          setAutoReload(
            globalConfig.autoReload !== undefined
              ? globalConfig.autoReload
              : true,
          );
          setAppearance(normalizeGraphAppearance(globalConfig.appearance));
        }
      } catch (e) {
        console.error("Failed to fetch global config", e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchGlobalConfig();
  }, []);

  const saveConfig = useMemo(
    () =>
      debounce(
        async (
          theme: "dark" | "light",
          reload: boolean,
          app: GraphAppearance,
        ) => {
          setIsSaving(true);
          try {
            await window.ipcRenderer.invoke("save-global-config", {
              theme,
              autoReload: reload,
              appearance: app,
            });
            setShowSaved(true);
            setTimeout(() => setShowSaved(false), 2000);
          } catch (err) {
            console.error("Failed to save global config", err);
          } finally {
            setIsSaving(false);
          }
        },
        1000,
      ),
    [],
  );

  const handleThemeChange = (theme: "dark" | "light") => {
    setAppTheme(theme);
    // Apply app theme immediately
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    saveConfig(theme, autoReload, appearance);
  };

  const handleAutoReloadChange = (checked: boolean) => {
    setAutoReload(checked);
    saveConfig(appTheme, checked, appearance);
  };

  const handleAppearanceChange = (newAppearance: GraphAppearance) => {
    setAppearance(newAppearance);
    saveConfig(appTheme, autoReload, newAppearance);
  };

  const updateNodeAppearance = (
    key: keyof NonNullable<GraphAppearance["nodes"]>,
    field: "color" | "radius",
    value: string | number,
  ) => {
    const nextAppearance = {
      ...appearance,
      nodes: {
        ...appearance.nodes,
        [key]: {
          ...appearance.nodes?.[key],
          [field]: value,
        },
      },
    };
    handleAppearanceChange(nextAppearance);
  };

  const ColorInput = ({
    label,
    colorKey,
    defaultValue,
  }: {
    label: string;
    colorKey: keyof GraphAppearance;
    defaultValue: string;
  }) => (
    <div className="flex items-center gap-4">
      <Input
        type="color"
        value={(appearance[colorKey] as string | undefined) || defaultValue}
        onChange={(e) =>
          handleAppearanceChange({ ...appearance, [colorKey]: e.target.value })
        }
        className="w-10 h-8 p-1 cursor-pointer"
      />
      <label className="text-xs">{label}</label>
    </div>
  );

  const NodeAppearanceInput = ({
    label,
    nodeKey,
    defaultColor,
    defaultRadius,
  }: {
    label: string;
    nodeKey: keyof NonNullable<GraphAppearance["nodes"]>;
    defaultColor: string;
    defaultRadius: number;
  }) => (
    <div className="rounded-md border border-border/40 p-2 space-y-2">
      <div className="text-[11px] font-medium opacity-70">{label}</div>
      <div className="flex items-center gap-2">
        <Input
          type="color"
          value={appearance.nodes?.[nodeKey]?.color || defaultColor}
          onChange={(e) =>
            updateNodeAppearance(nodeKey, "color", e.target.value)
          }
          className="w-10 h-8 p-1 cursor-pointer"
        />
        <Input
          type="number"
          min={8}
          max={80}
          step={1}
          value={appearance.nodes?.[nodeKey]?.radius || defaultRadius}
          onChange={(e) =>
            updateNodeAppearance(
              nodeKey,
              "radius",
              Number.parseInt(e.target.value || `${defaultRadius}`, 10),
            )
          }
          className="w-16 h-8 text-xs"
        />
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const isDark = appTheme === "dark";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between sticky top-0 bg-background/80 backdrop-blur-sm py-2 z-10 border-b border-border/40 mb-4">
        <h2 className="text-lg font-semibold tracking-tight">
          Global Settings
        </h2>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {isSaving && (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Saving...
            </>
          )}
          {showSaved && !isSaving && (
            <>
              <CheckCircle2 className="h-3 w-3 text-green-500" />
              Saved
            </>
          )}
        </div>
      </div>

      <div className="grid gap-6">
        <div className="space-y-4">
          <h3 className="text-sm font-semibold opacity-70">General</h3>
          <div className="grid grid-cols-2 gap-8">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Application Theme</label>
              <select
                value={appTheme}
                onChange={(e) =>
                  handleThemeChange(e.target.value as "dark" | "light")
                }
                className="w-full h-8 p-1 text-xs rounded-md border border-input bg-background"
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </div>
            <div className="flex items-center space-x-2 pt-5">
              <Checkbox
                id="auto-reload"
                checked={autoReload}
                onCheckedChange={(checked) => handleAutoReloadChange(!!checked)}
              />
              <div className="grid gap-1 leading-none">
                <label
                  htmlFor="auto-reload"
                  className="text-xs font-medium leading-none"
                >
                  Auto-reload on changes
                </label>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4 pt-4 border-t border-border/40">
          <h3 className="text-sm font-semibold opacity-70">
            Graph Base Colors
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <ColorInput
              label="Node Highlight"
              colorKey="nodeHighlight"
              defaultValue={isDark ? "#3b82f6" : "#2563eb"}
            />
            <ColorInput
              label="Combo Highlight"
              colorKey="comboHighlight"
              defaultValue={isDark ? "#3b82f6" : "#2563eb"}
            />
            <ColorInput
              label="Arrow Color"
              colorKey="arrowColor"
              defaultValue={isDark ? "#888888" : "#424242"}
            />
            <ColorInput
              label="Direct Flow"
              colorKey="directFlowColor"
              defaultValue={isDark ? "#60a5fa" : "#2563eb"}
            />
            <ColorInput
              label="Side Effect"
              colorKey="sideEffectFlowColor"
              defaultValue="#f59e0b"
            />
            <ColorInput
              label="Label Color"
              colorKey="labelColor"
              defaultValue={isDark ? "#ffffff" : "#000000"}
            />
          </div>
        </div>

        <div className="space-y-4 pt-4 border-t border-border/40">
          <h3 className="text-sm font-semibold opacity-70">
            Node Type Appearance
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            <NodeAppearanceInput
              label="Package"
              nodeKey="package"
              defaultColor="#0f766e"
              defaultRadius={24}
            />
            <NodeAppearanceInput
              label="Component"
              nodeKey="component"
              defaultColor={isDark ? "#3b82f6" : "#2563eb"}
              defaultRadius={20}
            />
            <NodeAppearanceInput
              label="Hook"
              nodeKey="hook"
              defaultColor={isDark ? "#8b5cf6" : "#7c3aed"}
              defaultRadius={18}
            />
            <NodeAppearanceInput
              label="Callback"
              nodeKey="callback"
              defaultColor="#ef4444"
              defaultRadius={14}
            />
            <NodeAppearanceInput
              label="State"
              nodeKey="state"
              defaultColor="#ef4444"
              defaultRadius={16}
            />
            <NodeAppearanceInput
              label="Effect"
              nodeKey="effect"
              defaultColor="#eab308"
              defaultRadius={14}
            />
            <NodeAppearanceInput
              label="Prop"
              nodeKey="prop"
              defaultColor="#22c55e"
              defaultRadius={12}
            />
            <NodeAppearanceInput
              label="Render"
              nodeKey="render"
              defaultColor="#3b82f6"
              defaultRadius={14}
            />
          </div>
        </div>

        <div className="space-y-4 pt-4 border-t border-border/40">
          <h3 className="text-sm font-semibold opacity-70">Git Status</h3>
          <div className="grid grid-cols-3 gap-3">
            <ColorInput
              label="Git Added"
              colorKey="gitAdded"
              defaultValue="#22c55e"
            />
            <ColorInput
              label="Git Modified"
              colorKey="gitModified"
              defaultValue="#f59e0b"
            />
            <ColorInput
              label="Git Deleted"
              colorKey="gitDeleted"
              defaultValue="#ef4444"
            />
          </div>
        </div>

        <div className="space-y-4 pt-4 border-t border-border/40 pb-4">
          <h3 className="text-sm font-semibold opacity-70">
            Type Highlighting
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <ColorInput
              label="Keyword"
              colorKey="typeKeyword"
              defaultValue="#c084fc"
            />
            <ColorInput
              label="Literal"
              colorKey="typeLiteral"
              defaultValue="#fdba74"
            />
            <ColorInput
              label="String"
              colorKey="typeString"
              defaultValue="#86efac"
            />
            <ColorInput
              label="Number"
              colorKey="typeNumber"
              defaultValue="#93c5fd"
            />
            <ColorInput
              label="Boolean"
              colorKey="typeBoolean"
              defaultValue="#fde047"
            />
            <ColorInput
              label="Reference"
              colorKey="typeReference"
              defaultValue="#60a5fa"
            />
            <ColorInput
              label="Component"
              colorKey="typeComponent"
              defaultValue="#67e8f9"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
