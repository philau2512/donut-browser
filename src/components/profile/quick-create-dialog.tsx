"use client";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  LuLoaderCircle,
  LuPencil,
  LuPlus,
  LuTrash2,
  LuZap,
} from "react-icons/lu";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProxyEvents } from "@/hooks/use-proxy-events";
import { useVpnEvents } from "@/hooks/use-vpn-events";
import { getCurrentOS } from "@/lib/browser-utils";
import {
  clampQuickCreateQuantity,
  draftFromTemplate,
  draftToTemplate,
  emptyQuickCreateDraft,
  QUICK_CREATE_MAX_QTY,
  QUICK_CREATE_NONE,
  type QuickCreateTemplateDraft,
  quickCreateProgressPercent,
} from "@/lib/quick-create";
import { cn } from "@/lib/utils";
import type {
  ExtensionGroup,
  GroupWithCount,
  ProfileStatusConfig,
  QuickCreateProgress,
  QuickCreateTemplate,
  WayfernOS,
} from "@/types";

import { QuickCreateTemplateEditor } from "./quick-create-template-editor";

const NONE = QUICK_CREATE_NONE;
const MAX_QTY = QUICK_CREATE_MAX_QTY;

type TemplateDraft = QuickCreateTemplateDraft;

interface QuickCreateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedGroupId?: string | null;
  crossOsUnlocked?: boolean;
}

export function QuickCreateDialog({
  isOpen,
  onClose,
  selectedGroupId,
  crossOsUnlocked = false,
}: QuickCreateDialogProps) {
  const { t } = useTranslation();
  const hostOs = (() => {
    const os = getCurrentOS();
    if (os === "windows" || os === "macos" || os === "linux") return os;
    return "windows" as WayfernOS;
  })();

  const [tab, setTab] = useState<"create" | "templates">("create");
  const [templates, setTemplates] = useState<QuickCreateTemplate[]>([]);
  const [groups, setGroups] = useState<GroupWithCount[]>([]);
  const [extensionGroups, setExtensionGroups] = useState<ExtensionGroup[]>([]);
  const [statuses, setStatuses] = useState<ProfileStatusConfig[]>([]);
  const [versions, setVersions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  // Create tab
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [quantity, setQuantity] = useState(1);
  const [groupId, setGroupId] = useState<string>(NONE);
  const [isCreating, setIsCreating] = useState(false);
  const [progress, setProgress] = useState<QuickCreateProgress | null>(null);
  const [showProgress, setShowProgress] = useState(false);

  // Templates tab
  const [draft, setDraft] = useState<TemplateDraft>(() =>
    emptyQuickCreateDraft(hostOs),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { storedProxies } = useProxyEvents();
  const { vpnConfigs } = useVpnEvents();

  const loadTemplates = useCallback(async () => {
    try {
      const list = await invoke<QuickCreateTemplate[]>(
        "list_quick_create_templates",
      );
      setTemplates(list);
      if (list.length > 0) {
        setSelectedTemplateId((prev) =>
          prev && list.some((x) => x.id === prev) ? prev : list[0].id,
        );
      } else {
        setSelectedTemplateId("");
      }
    } catch (e) {
      console.error(e);
      toast.error(t("quickCreate.errors.loadTemplates"));
    }
  }, [t]);

  const loadMeta = useCallback(async () => {
    setLoading(true);
    try {
      const [g, eg, st, vers] = await Promise.all([
        invoke<GroupWithCount[]>("get_groups_with_profile_counts").catch(
          () => [] as GroupWithCount[],
        ),
        invoke<ExtensionGroup[]>("list_extension_groups").catch(
          () => [] as ExtensionGroup[],
        ),
        invoke<ProfileStatusConfig[]>("get_profile_statuses").catch(
          () => [] as ProfileStatusConfig[],
        ),
        invoke<string[]>("get_downloaded_browser_versions", {
          browserStr: "wayfern",
        }).catch(() => [] as string[]),
      ]);
      setGroups(g);
      setExtensionGroups(eg);
      setStatuses(st);
      setVersions(vers);
      if (vers.length > 0) {
        setDraft((d) => (d.version ? d : { ...d, version: vers[0] }));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void loadTemplates();
    void loadMeta();
    const gid =
      selectedGroupId && selectedGroupId !== "__all__" ? selectedGroupId : NONE;
    setGroupId(gid);
    setTab("create");
    setProgress(null);
    setShowProgress(false);
    setIsCreating(false);
  }, [isOpen, selectedGroupId, loadTemplates, loadMeta]);

  // Reload versions when browser engine changes in the template editor
  useEffect(() => {
    if (!isOpen) return;
    void invoke<string[]>("get_downloaded_browser_versions", {
      browserStr: draft.browser,
    })
      .then((vers) => {
        setVersions(vers);
        setDraft((d) => {
          if (d.version && vers.includes(d.version)) return d;
          return { ...d, version: vers[0] ?? "" };
        });
      })
      .catch(() => setVersions([]));
  }, [isOpen, draft.browser]);

  // Progress listener
  useEffect(() => {
    if (!isOpen) return;
    let unlisten: (() => void) | undefined;
    void listen<QuickCreateProgress>("quick-create-progress", (event) => {
      setProgress(event.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [isOpen]);

  const selectedTemplate = useMemo(
    () => templates.find((x) => x.id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId],
  );

  const canCreate =
    !!selectedTemplate && quantity >= 1 && quantity <= MAX_QTY && !isCreating;

  const handleCreate = async () => {
    if (!selectedTemplate || !canCreate) return;
    setIsCreating(true);
    setShowProgress(true);
    setProgress({
      total: quantity,
      completed: 0,
      index: 0,
      name: "",
      status: "creating",
    });

    try {
      const created = await invoke("quick_create_profiles", {
        templateId: selectedTemplate.id,
        count: quantity,
        groupId: groupId !== NONE ? groupId : null,
      });
      const count = Array.isArray(created) ? created.length : quantity;
      toast.success(t("quickCreate.created", { count }));
      setShowProgress(false);
      onClose();
    } catch (error) {
      console.error(error);
      toast.error(
        t("quickCreate.errors.createFailed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      // Allow dismissing progress after failure
      setShowProgress(false);
    } finally {
      setIsCreating(false);
    }
  };

  const startNewTemplate = () => {
    setEditingId(null);
    setDraft({
      ...emptyQuickCreateDraft(hostOs),
      version: versions[0] ?? "",
    });
    setTab("templates");
  };

  const startEditTemplate = (tpl: QuickCreateTemplate) => {
    setEditingId(tpl.id);
    setDraft(draftFromTemplate(tpl, hostOs));
    setTab("templates");
  };

  const handleSaveTemplate = async () => {
    if (!draft.name.trim()) {
      toast.error(t("quickCreate.errors.nameRequired"));
      return;
    }
    if (!draft.version) {
      toast.error(t("quickCreate.errors.versionRequired"));
      return;
    }
    if (!crossOsUnlocked && draft.os !== hostOs) {
      toast.error(t("quickCreate.errors.crossOsLocked"));
      return;
    }

    setIsSaving(true);
    try {
      const payload = draftToTemplate(draft);
      await invoke<QuickCreateTemplate>("save_quick_create_template", {
        template: payload,
      });
      toast.success(t("quickCreate.templateSaved"));
      setEditingId(null);
      setDraft({
        ...emptyQuickCreateDraft(hostOs),
        version: versions[0] ?? "",
      });
      await loadTemplates();
    } catch (error) {
      console.error(error);
      toast.error(
        t("quickCreate.errors.saveFailed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    try {
      await invoke("delete_quick_create_template", { id });
      toast.success(t("quickCreate.templateDeleted"));
      if (editingId === id) {
        setEditingId(null);
        setDraft({
          ...emptyQuickCreateDraft(hostOs),
          version: versions[0] ?? "",
        });
      }
      await loadTemplates();
    } catch (error) {
      console.error(error);
      toast.error(t("quickCreate.errors.deleteFailed"));
    }
  };

  const progressPercent = progress
    ? quickCreateProgressPercent(progress.completed, progress.total)
    : 0;

  return (
    <>
      <Dialog
        open={isOpen && !showProgress}
        onOpenChange={(open) => {
          if (!open && !isCreating) onClose();
        }}
      >
        <DialogContent className="flex h-[88vh] w-[94vw] max-w-6xl flex-col gap-0 overflow-hidden p-0">
          <div className="border-b px-6 py-4">
            <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
              <LuZap className="size-5 text-blue-500" />
              {t("quickCreate.title")}
            </DialogTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("quickCreate.subtitle")}
            </p>
          </div>

          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as "create" | "templates")}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="border-b px-6">
              <TabsList className="h-10 w-full justify-start rounded-none bg-transparent p-0">
                <TabsTrigger
                  value="create"
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
                >
                  {t("quickCreate.tabs.create")}
                </TabsTrigger>
                <TabsTrigger
                  value="templates"
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
                >
                  {t("quickCreate.tabs.templates")}
                </TabsTrigger>
              </TabsList>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-4 px-6 py-4">
                <TabsContent value="create" className="mt-0 space-y-4">
                  {loading ? (
                    <div className="flex items-center justify-center py-12 text-muted-foreground">
                      <LuLoaderCircle className="mr-2 size-4 animate-spin" />
                      {t("common.buttons.loading")}
                    </div>
                  ) : templates.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-8 text-center">
                      <p className="text-sm text-muted-foreground">
                        {t("quickCreate.noTemplates")}
                      </p>
                      <Button
                        className="mt-4"
                        size="sm"
                        onClick={startNewTemplate}
                      >
                        <LuPlus className="mr-1.5 size-3.5" />
                        {t("quickCreate.createFirstTemplate")}
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-2">
                        <Label>{t("quickCreate.template")}</Label>
                        <Select
                          value={selectedTemplateId}
                          onValueChange={setSelectedTemplateId}
                        >
                          <SelectTrigger>
                            <SelectValue
                              placeholder={t("quickCreate.selectTemplate")}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {templates.map((tpl) => (
                              <SelectItem key={tpl.id} value={tpl.id}>
                                {tpl.name}
                                <span className="ml-2 text-xs text-muted-foreground">
                                  ({tpl.browser} · {tpl.version})
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="qc-qty">
                            {t("quickCreate.quantity")}
                          </Label>
                          <Input
                            id="qc-qty"
                            type="number"
                            min={1}
                            max={MAX_QTY}
                            value={quantity}
                            onChange={(e) => {
                              const n = Number.parseInt(e.target.value, 10);
                              setQuantity(clampQuickCreateQuantity(n));
                            }}
                          />
                          <p className="text-xs text-muted-foreground">
                            {t("quickCreate.quantityHint", { max: MAX_QTY })}
                          </p>
                        </div>

                        <div className="space-y-2">
                          <Label>{t("quickCreate.folder")}</Label>
                          <Select value={groupId} onValueChange={setGroupId}>
                            <SelectTrigger>
                              <SelectValue
                                placeholder={t("quickCreate.noFolder")}
                              />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>
                                {t("quickCreate.noFolder")}
                              </SelectItem>
                              {groups.map((g) => (
                                <SelectItem key={g.id} value={g.id}>
                                  {g.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                        {t("quickCreate.lazyHint")}
                      </div>

                      <div className="flex justify-end gap-2 pt-2">
                        <Button variant="outline" onClick={onClose}>
                          {t("common.buttons.cancel")}
                        </Button>
                        <Button
                          onClick={() => void handleCreate()}
                          disabled={!canCreate}
                        >
                          {isCreating ? (
                            <LuLoaderCircle className="mr-1.5 size-3.5 animate-spin" />
                          ) : (
                            <LuZap className="mr-1.5 size-3.5" />
                          )}
                          {t("quickCreate.createButton", { count: quantity })}
                        </Button>
                      </div>
                    </>
                  )}
                </TabsContent>

                <TabsContent value="templates" className="mt-0 space-y-4">
                  {/* Existing list */}
                  {templates.length > 0 && (
                    <div className="space-y-2">
                      <Label>{t("quickCreate.savedTemplates")}</Label>
                      <div className="divide-y rounded-md border">
                        {templates.map((tpl) => (
                          <div
                            key={tpl.id}
                            className={cn(
                              "flex items-center justify-between gap-2 px-3 py-2",
                              editingId === tpl.id && "bg-muted/40",
                            )}
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">
                                {tpl.name}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {tpl.browser} · {tpl.version}
                                {tpl.wayfern_config?.os ||
                                tpl.camoufox_config?.os
                                  ? ` · ${tpl.wayfern_config?.os || tpl.camoufox_config?.os}`
                                  : ""}
                              </div>
                            </div>
                            <div className="flex shrink-0 gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-8"
                                onClick={() => startEditTemplate(tpl)}
                                aria-label={t("common.buttons.edit")}
                              >
                                <LuPencil className="size-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-8 text-destructive"
                                onClick={() =>
                                  void handleDeleteTemplate(tpl.id)
                                }
                                aria-label={t("common.buttons.delete")}
                              >
                                <LuTrash2 className="size-3.5" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="rounded-lg border p-4">
                    <div className="mb-4 flex items-center justify-between">
                      <Label className="text-sm font-semibold">
                        {editingId
                          ? t("quickCreate.editTemplate")
                          : t("quickCreate.newTemplate")}
                      </Label>
                      {editingId && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingId(null);
                            setDraft({
                              ...emptyQuickCreateDraft(hostOs),
                              version: versions[0] ?? "",
                            });
                          }}
                        >
                          {t("quickCreate.cancelEdit")}
                        </Button>
                      )}
                    </div>
                    <QuickCreateTemplateEditor
                      draft={draft}
                      onDraftChange={setDraft}
                      versions={versions}
                      storedProxies={storedProxies}
                      vpnConfigs={vpnConfigs}
                      extensionGroups={extensionGroups}
                      statuses={statuses}
                      hostOs={hostOs}
                      crossOsUnlocked={crossOsUnlocked}
                      isSaving={isSaving}
                    />
                  </div>
                </TabsContent>
              </div>
            </ScrollArea>
            {tab === "templates" && (
              <div className="flex shrink-0 justify-end border-t bg-background px-6 py-4">
                <Button
                  onClick={() => void handleSaveTemplate()}
                  disabled={isSaving}
                >
                  {isSaving && (
                    <LuLoaderCircle className="mr-1.5 size-3.5 animate-spin" />
                  )}
                  {editingId
                    ? t("common.buttons.save")
                    : t("quickCreate.saveTemplate")}
                </Button>
              </div>
            )}
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Progress modal */}
      <Dialog open={showProgress} onOpenChange={() => {}}>
        <DialogContent className="max-w-md" dismissible={false}>
          <DialogTitle>{t("quickCreate.progressTitle")}</DialogTitle>
          <div className="space-y-3 py-2">
            <Progress value={progressPercent} />
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>
                {t("quickCreate.progressCount", {
                  completed: progress?.completed ?? 0,
                  total: progress?.total ?? quantity,
                })}
              </span>
              <span>{progressPercent}%</span>
            </div>
            {progress?.name ? (
              <p className="truncate text-sm">
                {progress.status === "creating"
                  ? t("quickCreate.creatingName", { name: progress.name })
                  : progress.status === "created"
                    ? t("quickCreate.createdName", { name: progress.name })
                    : progress.name}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("quickCreate.progressPreparing")}
              </p>
            )}
            {progress?.error && (
              <p className="text-sm text-destructive">{progress.error}</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default QuickCreateDialog;
