import type { DetailSection } from "@nexiq/extension-sdk";
import { BasicInfoSection } from "@/components/details-sections/BasicInfoSection";
import { PropsSection } from "@/components/details-sections/PropsSection";
import { ChildrenSection } from "@/components/details-sections/ChildrenSection";
import { HooksSection } from "@/components/details-sections/HooksSection";
import { GitSection } from "@/components/details-sections/GitSection";
import { UsagesSection } from "@/components/details-sections/UsagesSection";
import type { GraphData } from "@/graph/hook";

const registry: DetailSection<GraphData>[] = [
  {
    id: "basic-info",
    title: "Basic Info",
    priority: 0,
    component: BasicInfoSection,
    shouldShow: () => true,
    defaultOpen: true,
  },
  {
    id: "props",
    title: "Props",
    priority: 10,
    component: PropsSection,
    shouldShow: (_baseItem, detail) => {
      return !!(detail?.props || detail?.propType);
    },
    defaultOpen: true,
  },
  {
    id: "children",
    title: "Children",
    priority: 20,
    component: ChildrenSection,
    shouldShow: (_baseItem, detail) => {
      return !!(detail?.children && Object.keys(detail.children).length > 0);
    },
  },
  {
    id: "hooks",
    title: "Hooks",
    priority: 30,
    component: HooksSection,
    shouldShow: (_baseItem, detail) => {
      return !!(detail?.hooks && detail.hooks.length > 0);
    },
  },
  {
    id: "usages",
    title: "Usages",
    priority: 35,
    component: UsagesSection,
    shouldShow: (_baseItem) => true,
  },
  {
    id: "git",
    title: "Git",
    priority: 40,
    component: GitSection,
    shouldShow: (_baseItem, detail) => {
      return !!detail?.gitStatus;
    },
  },
];

/**
 * Returns a prioritized list of detail sections.
 */
export function getDetailSections(): DetailSection<GraphData>[] {
  return [...registry].sort((a, b) => a.priority - b.priority);
}

/**
 * Registers a new detail section.
 */
export function registerDetailSection(section: DetailSection<GraphData>) {
  registry.push(section);
}
