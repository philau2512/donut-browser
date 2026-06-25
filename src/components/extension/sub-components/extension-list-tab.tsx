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
import type { Extension } from "@/types";

interface ExtensionListTabProps {
  extensions: Extension[];
  isLoading: boolean;
  limitedMode: boolean;
  selectedExtensions: Extension[];
  extTable: ReactTable<Extension>;
  showUploadForm: boolean;
  setShowUploadForm: (show: boolean) => void;
  pendingFile: { name: string; data: number[] } | null;
  setPendingFile: (file: { name: string; data: number[] } | null) => void;
  extensionName: string;
  setExtensionName: (name: string) => void;
  isUploading: boolean;
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleUpload: () => Promise<void>;
}

export function ExtensionListTab({
  extensions,
  isLoading,
  limitedMode,
  selectedExtensions,
  extTable,
  showUploadForm,
  setShowUploadForm,
  pendingFile,
  setPendingFile,
  extensionName,
  setExtensionName,
  isUploading,
  handleFileSelect,
  handleUpload,
}: ExtensionListTabProps) {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Input
        id="ext-file-input"
        type="file"
        accept=".xpi,.crx,.zip"
        className="hidden"
        onChange={handleFileSelect}
        disabled={limitedMode}
      />

      {/* Upload form */}
      {showUploadForm && pendingFile && (
        <div className="space-y-3 rounded-md border p-3">
          <div className="text-sm text-muted-foreground">
            {t("extensions.selectedFile")}:{" "}
            <span className="font-medium text-foreground">
              {pendingFile.name}
            </span>
          </div>
          <div className="flex gap-2">
            <Input
              value={extensionName}
              onChange={(e) => setExtensionName(e.target.value)}
              placeholder={t("extensions.namePlaceholder")}
              className="flex-1"
            />
            <RippleButton
              size="sm"
              onClick={() => void handleUpload()}
              disabled={isUploading || !extensionName.trim()}
            >
              {isUploading
                ? t("common.buttons.loading")
                : t("common.buttons.add")}
            </RippleButton>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setShowUploadForm(false);
                setPendingFile(null);
                setExtensionName("");
              }}
            >
              {t("common.buttons.cancel")}
            </Button>
          </div>
        </div>
      )}

      {/* Extensions list */}
      {isLoading ? (
        <div className="text-sm text-muted-foreground">
          {t("common.buttons.loading")}
        </div>
      ) : extensions.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          {t("extensions.empty")}
        </div>
      ) : (
        <FadingScrollArea
          className={cn(
            "min-h-0 flex-1",
            selectedExtensions.length > 0 && "pb-16",
          )}
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
              {extTable.getHeaderGroups().map((headerGroup) => (
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
              {extTable.getRowModel().rows.map((row) => (
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
