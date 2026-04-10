import type { DetailSection } from "@nexiq/extension-sdk";
import { BasicInfoSection } from "@/components/details-sections/BasicInfoSection";
import { PropsSection } from "@/components/details-sections/PropsSection";
import { ChildrenSection } from "@/components/details-sections/ChildrenSection";
import { HooksSection } from "@/components/details-sections/HooksSection";
import { GitSection } from "@/components/details-sections/GitSection";
import { UsagesSection } from "@/components/details-sections/UsagesSection";
import { type GraphNodeData } from "@/graph/hook";

const registry: DetailSection[] = [
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
    shouldShow: (baseItem) => {
      const item = baseItem as GraphNodeData;
      return !!(item.hasProps || item.propType);
    },
    defaultOpen: true,
  },
  {
    id: "children",
    title: "Children",
    priority: 20,
    component: ChildrenSection,
    shouldShow: (baseItem) => {
      const item = baseItem as GraphNodeData;
      return !!item.hasChildren;
    },
  },
  {
    id: "hooks",
    title: "Hooks",
    priority: 30,
    component: HooksSection,
    shouldShow: (baseItem) => {
      const item = baseItem as GraphNodeData;
      return !!item.hasHooks;
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
    shouldShow: (baseItem) => {
      const item = baseItem as GraphNodeData;
      return !!item.gitStatus;
    },
  },
];

/**
 * Returns a prioritized list of detail sections.
 */
export function getDetailSections(): DetailSection[] {
  return [...registry].sort((a, b) => a.priority - b.priority);
}

/**
 * Registers a new detail section.
 */
export function registerDetailSection(section: DetailSection) {
  registry.push(section);
}
