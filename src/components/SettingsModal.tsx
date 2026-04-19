import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProjectSettings } from "@/pages/ProjectSettings";
import { GlobalSettings } from "@/pages/GlobalSettings";
import { useAppStateStore } from "@/hooks/use-app-state-store";
import { useProjectStore } from "@/hooks/use-project-store";
import { Settings, FolderCog, Globe } from "lucide-react";

export function SettingsModal() {
  const { isSettingsModalOpen, setSettingsModalOpen } = useAppStateStore();
  const { projectRoot } = useProjectStore();

  return (
    <Dialog open={isSettingsModalOpen} onOpenChange={setSettingsModalOpen}>
      <DialogContent className="max-w-[90vw]! w-full h-[90vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="p-6 pb-2 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Settings
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-hidden">
          <Tabs defaultValue="project" className="h-full flex flex-col">
            <div className="px-6 border-b bg-muted/20">
              <TabsList className="h-10 bg-transparent gap-6">
                <TabsTrigger
                  value="project"
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-2"
                >
                  <FolderCog className="h-4 w-4 mr-2" />
                  Project
                </TabsTrigger>
                <TabsTrigger
                  value="global"
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-2"
                >
                  <Globe className="h-4 w-4 mr-2" />
                  Global
                </TabsTrigger>
              </TabsList>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <TabsContent
                value="project"
                className="m-0 focus-visible:outline-none"
              >
                {projectRoot ? (
                  <ProjectSettings projectPath={projectRoot} />
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    Select a project to see project settings.
                  </div>
                )}
              </TabsContent>
              <TabsContent
                value="global"
                className="m-0 focus-visible:outline-none"
              >
                <GlobalSettings projectPath={projectRoot || undefined} />
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
