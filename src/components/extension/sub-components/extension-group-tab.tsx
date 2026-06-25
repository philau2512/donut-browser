"use client";

import { flexRender, type Table as ReactTable } from "@tanstack/react-table";
import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { FadingScrollArea } from "@/components/ui/fading-scroll-area";
import { Input } from "@/components/ui/input";
import { RippleButton } from "@/components/ui/ripple";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { ExtensionGroup } from "@/types";

interface ExtensionGroupTabProps {
  extensionGroups: ExtensionGroup[];
  selectedGroups: ExtensionGroup[];
  groupTable: ReactTable<ExtensionGroup>;
  showCreateGroup: boolean;
  setShowCreateGroup: (show: boolean) => void;
  newGroupName: string;
  setNewGroupName: (name: string) => void;
  handleCreateGroup: () => Promise<void>;
}

export function ExtensionGroupTab({
  extensionGroups,
  selectedGroups,
  groupTable,
  showCreateGroup,
  setShowCreateGroup,
  newGroupName,
  setNewGroupName,
  handleCreateGroup,
}: ExtensionGroupTabProps) {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* Create group form */}
      {showCreateGroup && (
        <div className="flex items-center gap-2">
          <Input
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder={t("extensions.groupNamePlaceholder")}
            className="flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreateGroup();
            }}
          />
          <RippleButton
            size="sm"
            onClick={() => void handleCreateGroup()}
            disabled={!newGroupName.trim()}
          >
            {t("common.buttons.create")}
          </RippleButton>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setShowCreateGroup(false);
              setNewGroupName("");
            }}
          >
            {t("common.buttons.cancel")}
          </Button>
        </div>
      )}

      {/* Groups list */}
      {extensionGroups.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          {t("extensions.noGroups")}
        </div>
      ) : (
        <FadingScrollArea
          className={cn("min-h-0 flex-1", selectedGroups.length > 0 && "pb-16")}
          style={
            {
              "--scroll-fade-top-offset": "32px",
            } as React.CSSProperties
          }
        >
          <Table
            className="w-full table-fixed"
            containerClassName="overflow-visible"
          >
            <TableHeader className="sticky top-0 z-10 bg-background">
              {groupTable.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      style={{
                        width:
                          header.column.id === "name"
                            ? undefined
                            : `${header.column.getSize()}px`,
                      }}
                      className={cn(header.column.id === "name" && "max-w-0")}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {groupTable.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      style={{
                        width:
                          cell.column.id === "name"
                            ? undefined
                            : `${cell.column.getSize()}px`,
                      }}
                      className={cn(cell.column.id === "name" && "max-w-0")}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </FadingScrollArea>
      )}
    </div>
  );
}
