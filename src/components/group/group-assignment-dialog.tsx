"use client";

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuChevronLeft, LuChevronRight, LuFolder } from "react-icons/lu";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { translateBackendError } from "@/lib/backend-errors";
import { cn } from "@/lib/utils";
import type { BrowserProfile, GroupWithCount } from "@/types";

const PAGE_SIZE = 8;

interface GroupAssignmentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedProfiles: string[];
  onAssignmentComplete: () => void;
  profiles?: BrowserProfile[];
}

export function GroupAssignmentDialog({
  isOpen,
  onClose,
  selectedProfiles,
  onAssignmentComplete,
}: GroupAssignmentDialogProps) {
  const { t } = useTranslation();
  const [groups, setGroups] = useState<GroupWithCount[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [assigningGroupId, setAssigningGroupId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [page, setPage] = useState(0);

  const loadGroups = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const groupList = await invoke<GroupWithCount[]>(
        "get_groups_with_profile_counts",
      );
      setGroups(groupList);
    } catch (err) {
      console.error("Failed to load groups:", err);
      setError(
        err instanceof Error ? err.message : t("groupManagement.loadFailed"),
      );
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!isOpen) return;
    setNewFolderName("");
    setPage(0);
    setError(null);
    setAssigningGroupId(null);
    void loadGroups();
  }, [isOpen, loadGroups]);

  const totalPages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));

  useEffect(() => {
    if (page > totalPages - 1) {
      setPage(Math.max(0, totalPages - 1));
    }
  }, [page, totalPages]);

  const pageGroups = useMemo(() => {
    const start = page * PAGE_SIZE;
    return groups.slice(start, start + PAGE_SIZE);
  }, [groups, page]);

  const handleCreate = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name || isCreating) return;

    setIsCreating(true);
    setError(null);
    try {
      await invoke("create_profile_group", { name });
      toast.success(t("groups.createSuccess"));
      setNewFolderName("");
      await loadGroups();
      // Jump to last page so the new folder is visible.
      setPage(Math.max(0, Math.ceil((groups.length + 1) / PAGE_SIZE) - 1));
    } catch (err) {
      console.error("Failed to create group:", err);
      const errorMessage = translateBackendError(t, err);
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsCreating(false);
    }
  }, [newFolderName, isCreating, t, loadGroups, groups.length]);

  const handleAssign = useCallback(
    async (group: GroupWithCount) => {
      if (assigningGroupId || selectedProfiles.length === 0) return;

      setAssigningGroupId(group.id);
      setError(null);
      try {
        await invoke("assign_profiles_to_group", {
          profileIds: selectedProfiles,
          groupId: group.id,
        });

        toast.success(
          t("groups.assignSuccess", {
            count: selectedProfiles.length,
            group: group.name,
          }),
        );
        onAssignmentComplete();
        onClose();
      } catch (err) {
        console.error("Failed to assign profiles to group:", err);
        const errorMessage =
          err instanceof Error
            ? err.message
            : t("groupAssignment.failedFallback");
        setError(errorMessage);
        toast.error(errorMessage);
      } finally {
        setAssigningGroupId(null);
      }
    },
    [assigningGroupId, selectedProfiles, onAssignmentComplete, onClose, t],
  );

  const busy = isCreating || assigningGroupId !== null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[min(85vh,720px)] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="text-base font-semibold">
            {t("groupAssignment.title")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 px-5 py-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">
              {t("groupAssignment.addNewFolder")}
              <span className="ml-0.5 text-red-500">*</span>
            </Label>
            <div className="flex items-center gap-2">
              <Input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newFolderName.trim()) {
                    void handleCreate();
                  }
                }}
                placeholder={t("groupAssignment.folderNamePlaceholder")}
                disabled={busy}
                className="h-9 flex-1 bg-muted/30"
              />
              <Button
                type="button"
                onClick={() => void handleCreate()}
                disabled={busy || !newFolderName.trim()}
                className="h-9 shrink-0 bg-blue-600 px-4 font-medium text-white hover:bg-blue-700"
              >
                {isCreating
                  ? t("common.buttons.loading")
                  : t("groupAssignment.create")}
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
            <Table containerClassName="max-h-[min(48vh,420px)] overflow-y-auto">
              <TableHeader className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-14 text-center font-semibold text-foreground">
                    {t("groupAssignment.colNo")}
                  </TableHead>
                  <TableHead className="font-semibold text-foreground">
                    {t("groupAssignment.colName")}
                  </TableHead>
                  <TableHead className="w-32 text-center font-semibold text-foreground">
                    {t("groupAssignment.colProfiles")}
                  </TableHead>
                  <TableHead className="w-28 text-center font-semibold text-foreground">
                    {t("groupAssignment.colAction")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="h-28 text-center text-muted-foreground"
                    >
                      {t("groupManagement.loading")}
                    </TableCell>
                  </TableRow>
                ) : pageGroups.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="h-28 text-center text-muted-foreground"
                    >
                      {t("groupAssignment.empty")}
                    </TableCell>
                  </TableRow>
                ) : (
                  pageGroups.map((group, index) => {
                    const rowNo = page * PAGE_SIZE + index + 1;
                    const isAssigning = assigningGroupId === group.id;
                    return (
                      <TableRow key={group.id}>
                        <TableCell className="text-center tabular-nums text-muted-foreground">
                          {rowNo}
                        </TableCell>
                        <TableCell>
                          <div className="flex min-w-0 items-center gap-2">
                            <LuFolder className="size-4 shrink-0 text-blue-400" />
                            <span className="truncate font-medium">
                              {group.name}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center text-muted-foreground">
                          {t("groupAssignment.profileCount", {
                            count: group.count,
                          })}
                        </TableCell>
                        <TableCell className="text-center">
                          <Button
                            type="button"
                            size="sm"
                            disabled={busy || selectedProfiles.length === 0}
                            onClick={() => void handleAssign(group)}
                            className="h-8 min-w-16 bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700"
                          >
                            {isAssigning
                              ? t("common.buttons.loading")
                              : t("groupAssignment.add")}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {error ? (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8"
              disabled={page <= 0 || busy}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              aria-label={t("groupAssignment.prevPage")}
            >
              <LuChevronLeft className="size-4" />
            </Button>
            <span
              className={cn(
                "flex size-8 items-center justify-center rounded-md border border-blue-500 text-sm font-medium text-blue-400",
              )}
            >
              {page + 1}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8"
              disabled={page >= totalPages - 1 || busy || groups.length === 0}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              aria-label={t("groupAssignment.nextPage")}
            >
              <LuChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
