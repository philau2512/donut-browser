"use client";

import { invoke } from "@tauri-apps/api/core";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { LuSettings2 } from "react-icons/lu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { BrowserProfile, ProfileStatusConfig } from "@/types";
import { StatusSettingDialog } from "./status-setting-dialog";

interface StatusCellProps {
  profile: BrowserProfile;
  isDisabled: boolean;
  profileStatuses: ProfileStatusConfig[];
  statusOverrides: Record<string, string | null>;
  setStatusOverrides: React.Dispatch<
    React.SetStateAction<Record<string, string | null>>
  >;
  setProfileStatuses: React.Dispatch<
    React.SetStateAction<ProfileStatusConfig[]>
  >;
}

export const StatusCell = React.memo<StatusCellProps>(
  ({
    profile,
    isDisabled,
    profileStatuses,
    statusOverrides,
    setStatusOverrides,
    setProfileStatuses,
  }) => {
    const { t } = useTranslation();
    const [popoverOpen, setPopoverOpen] = useState(false);
    const [settingOpen, setSettingOpen] = useState(false);

    const effectiveStatus: string | null = Object.hasOwn(
      statusOverrides,
      profile.id,
    )
      ? statusOverrides[profile.id]
      : (profile.profile_status ?? null);

    const resolvedConfig = profileStatuses.find(
      (s) => s.label === effectiveStatus,
    );

    const handleSelect = async (label: string | null) => {
      setPopoverOpen(false);
      setStatusOverrides((prev) => ({ ...prev, [profile.id]: label }));
      try {
        await invoke("update_profile_status", {
          profileId: profile.id,
          profileStatus: label,
        });
      } catch (e) {
        // Rollback on error
        setStatusOverrides((prev) => {
          const next = { ...prev };
          delete next[profile.id];
          return next;
        });
        console.error("Failed to update profile status:", e);
      }
    };

    const badgeContent = effectiveStatus ? (
      <Badge
        className="px-2 py-0.5 rounded-sm text-[10px] font-medium shadow-none select-none border-0 cursor-pointer"
        style={{
          backgroundColor: resolvedConfig
            ? `${resolvedConfig.color}26`
            : "transparent",
          color: resolvedConfig?.color ?? "inherit",
          outline: `1px solid ${resolvedConfig ? `${resolvedConfig.color}4d` : "transparent"}`,
        }}
      >
        {effectiveStatus}
      </Badge>
    ) : (
      <span className="text-[11px] text-muted-foreground select-none cursor-pointer">
        {t("profiles.status.noStatus")}
      </span>
    );

    return (
      <>
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild disabled={isDisabled}>
            <div className="flex justify-center items-center w-full h-full min-h-[32px]">
              {badgeContent}
            </div>
          </PopoverTrigger>
          <PopoverContent
            className="w-44 p-1"
            align="center"
            side="bottom"
            onClick={(e) => e.stopPropagation()}
          >
            {/* No Status option */}
            <button
              type="button"
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-sm hover:bg-muted/60 transition-colors",
                !effectiveStatus && "bg-muted/40",
              )}
              onClick={() => handleSelect(null)}
            >
              <span className="w-3 h-3 rounded-full border border-border bg-muted shrink-0" />
              <span className="text-muted-foreground">
                {t("profiles.status.noStatus")}
              </span>
            </button>

            {profileStatuses.map((s) => (
              <button
                key={s.label}
                type="button"
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-sm hover:bg-muted/60 transition-colors",
                  effectiveStatus === s.label && "bg-muted/40",
                )}
                onClick={() => handleSelect(s.label)}
              >
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: s.color }}
                />
                <span className="truncate">{s.label}</span>
              </button>
            ))}

            {/* Status settings link */}
            <div className="border-t border-border mt-1 pt-1">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2 h-7 text-xs text-muted-foreground"
                onClick={() => {
                  setPopoverOpen(false);
                  setSettingOpen(true);
                }}
              >
                <LuSettings2 className="h-3 w-3" />
                {t("profiles.status.setting")}
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        <StatusSettingDialog
          open={settingOpen}
          onOpenChange={setSettingOpen}
          statuses={profileStatuses}
          onStatusesChange={setProfileStatuses}
        />
      </>
    );
  },
);

StatusCell.displayName = "StatusCell";
