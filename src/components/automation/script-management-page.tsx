"use client";

import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  LuCopy,
  LuDownload,
  LuPencil,
  LuPlay,
  LuPlus,
  LuSearch,
  LuTrash2,
  LuUpload,
} from "react-icons/lu";
import { DeleteConfirmationDialog } from "@/components/shared";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  type FlowMeta,
  useScriptManagement,
} from "@/hooks/use-script-management";
import { showErrorToast, showSuccessToast } from "@/lib/toast-utils";

interface ScriptManagementPageProps {
  /** Open the run panel for a flow. */
  onRun: (flowPath: string) => void;
  /** Open the editor for an existing flow. */
  onEdit: (flowPath: string) => void;
  /** Open the editor for a new (unsaved) flow. */
  onCreate: () => void;
}

/** Format an epoch-ms timestamp for the card subtitle; empty string if null. */
function formatModified(ms: number | null): string {
  if (ms == null) return "";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "";
  }
}

/** Build the next free "<base> (n)" name given the set of taken stems. */
function nextDuplicateName(base: string, taken: Set<string>): string {
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} (${i})`;
    if (!taken.has(candidate)) return candidate;
  }
  // Fallback: timestamp suffix (practically unreachable).
  return `${base} (${Date.now()})`;
}

/** Grid of `.donutflow` scripts with CRUD + run + import/export, modeled on the
 * Hidemium script-management screen. */
export function ScriptManagementPage({
  onRun,
  onEdit,
  onCreate,
}: ScriptManagementPageProps) {
  const { t } = useTranslation();
  const { flows, isLoading, reload, readFlow, writeFlow, deleteFlow } =
    useScriptManagement();

  const [search, setSearch] = useState("");
  const [pendingDelete, setPendingDelete] = useState<FlowMeta | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [busyPath, setBusyPath] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return flows;
    return flows.filter((f) => f.name.toLowerCase().includes(q));
  }, [flows, search]);

  const takenNames = useMemo(() => new Set(flows.map((f) => f.name)), [flows]);

  const handleDuplicate = async (flow: FlowMeta) => {
    setBusyPath(flow.path);
    try {
      const json = await readFlow(flow.path);
      if (json == null) return;
      const newName = nextDuplicateName(flow.name, takenNames);
      // overwrite=false: auto-suffixed name is unique, so it can't collide.
      await writeFlow(newName, json, false);
      showSuccessToast(
        t("automation.script.toast.duplicated", { name: newName }),
      );
      await reload();
    } catch (err) {
      showErrorToast(
        t("automation.script.errors.duplicateFailed", {
          error: JSON.stringify(err),
        }),
      );
    } finally {
      setBusyPath(null);
    }
  };

  const handleExport = async (flow: FlowMeta) => {
    setBusyPath(flow.path);
    try {
      const json = await readFlow(flow.path);
      if (json == null) return;
      const dest = await save({
        defaultPath: `${flow.name}.donutflow`,
        filters: [{ name: "Donut Flow", extensions: ["donutflow"] }],
      });
      if (!dest) return; // user cancelled
      await writeTextFile(dest, json);
      showSuccessToast(
        t("automation.script.toast.exported", { name: flow.name }),
      );
    } catch (err) {
      showErrorToast(
        t("automation.script.errors.exportFailed", {
          error: JSON.stringify(err),
        }),
      );
    } finally {
      setBusyPath(null);
    }
  };

  const handleImport = async () => {
    try {
      const picked = await open({
        multiple: false,
        filters: [{ name: "Donut Flow", extensions: ["donutflow"] }],
      });
      if (!picked || typeof picked !== "string") return;
      const json = await readTextFile(picked);
      // Derive a name from the imported file stem.
      const base =
        picked
          .split(/[/\\]/)
          .pop()
          ?.replace(/\.donutflow$/i, "") ?? "imported";
      // Import collision → confirm overwrite (same UX as Save). Try
      // overwrite=false first; if it reports "exists", ask the user.
      try {
        await writeFlow(base, json, false);
      } catch (err) {
        if (String(err) === "exists") {
          const ok = window.confirm(
            t("automation.script.confirm.overwriteImport", { name: base }),
          );
          if (!ok) return;
          await writeFlow(base, json, true);
        } else {
          throw err;
        }
      }
      showSuccessToast(t("automation.script.toast.imported", { name: base }));
      await reload();
    } catch (err) {
      showErrorToast(
        t("automation.script.errors.importFailed", {
          error: JSON.stringify(err),
        }),
      );
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    setIsDeleting(true);
    try {
      const ok = await deleteFlow(pendingDelete.path);
      if (ok) {
        showSuccessToast(
          t("automation.script.toast.deleted", { name: pendingDelete.name }),
        );
        await reload();
      }
    } finally {
      setIsDeleting(false);
      setPendingDelete(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <LuSearch className="-translate-y-1/2 absolute top-1/2 left-2.5 size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("automation.script.searchPlaceholder")}
            className="pl-8"
          />
        </div>
        <div className="ml-auto flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleImport()}
          >
            <LuUpload className="mr-2 size-4" />
            {t("automation.script.import")}
          </Button>
          <Button type="button" onClick={onCreate}>
            <LuPlus className="mr-2 size-4" />
            {t("automation.script.add")}
          </Button>
        </div>
      </div>

      {/* Grid */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {t("automation.script.loading")}
          </p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
            <p className="text-sm text-muted-foreground">
              {search.trim()
                ? t("automation.script.noMatches")
                : t("automation.script.empty")}
            </p>
            {!search.trim() && (
              <Button type="button" variant="outline" onClick={onCreate}>
                <LuPlus className="mr-2 size-4" />
                {t("automation.script.add")}
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((flow) => {
              const busy = busyPath === flow.path;
              const modified = formatModified(flow.modified_ms);
              return (
                <Card key={flow.path} className="gap-3 py-4">
                  <CardHeader className="px-4">
                    <CardTitle className="truncate text-sm" title={flow.name}>
                      {flow.name}
                    </CardTitle>
                    {modified && (
                      <p className="text-[11px] text-muted-foreground">
                        {t("automation.script.modifiedAt", { date: modified })}
                      </p>
                    )}
                  </CardHeader>
                  <CardContent className="px-4">
                    <Button
                      type="button"
                      size="sm"
                      className="w-full"
                      disabled={busy}
                      onClick={() => onRun(flow.path)}
                    >
                      <LuPlay className="mr-2 size-3.5" />
                      {t("automation.actions.run")}
                    </Button>
                  </CardContent>
                  <CardFooter className="flex flex-wrap gap-1 px-4">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => onEdit(flow.path)}
                    >
                      <LuPencil className="mr-1 size-3.5" />
                      {t("automation.script.edit")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void handleDuplicate(flow)}
                    >
                      <LuCopy className="mr-1 size-3.5" />
                      {t("automation.script.duplicate")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void handleExport(flow)}
                    >
                      <LuDownload className="mr-1 size-3.5" />
                      {t("automation.script.export")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      disabled={busy}
                      onClick={() => setPendingDelete(flow)}
                    >
                      <LuTrash2 className="mr-1 size-3.5" />
                      {t("automation.script.delete")}
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <DeleteConfirmationDialog
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={handleConfirmDelete}
        title={t("automation.script.confirm.deleteTitle")}
        description={t("automation.script.confirm.deleteDescription", {
          name: pendingDelete?.name ?? "",
        })}
        isLoading={isDeleting}
      />
    </div>
  );
}
