"use client";

import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import * as React from "react";
import { LuCookie, LuCopy, LuDownload, LuUpload } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { translateBackendError } from "@/lib/backend-errors";
import { showErrorToast, showSuccessToast } from "@/lib/toast-utils";
import type { BrowserProfile } from "@/types";

interface CookiesSectionInlineProps {
  profile: BrowserProfile;
  isRunning: boolean;
  isDisabled: boolean;
  onCopyCookies?: () => void;
  onImportCookies?: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

type CookieStats = {
  profile_id: string;
  browser_type: string;
  total_count: number;
  domains: { domain: string; count: number }[];
};

export function CookiesSectionInline({
  profile,
  isRunning,
  isDisabled,
  onCopyCookies,
  onImportCookies,
  t,
}: CookiesSectionInlineProps) {
  const [stats, setStats] = React.useState<CookieStats | null>(null);
  const [isLoading, setIsLoading] = React.useState(!isRunning);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (isRunning) {
      setStats(null);
      setIsLoading(false);
      setError(null);
      return;
    }
    let mounted = true;
    setIsLoading(true);
    setError(null);
    void (async () => {
      try {
        const data = await invoke<CookieStats>("get_profile_cookie_stats", {
          profileId: profile.id,
        });
        if (mounted) setStats(data);
      } catch (e) {
        if (mounted) setError(translateBackendError(t as never, e));
      } finally {
        if (mounted) setIsLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [profile.id, isRunning, t]);

  const [isExporting, setIsExporting] = React.useState(false);

  const handleExport = React.useCallback(
    async (format: "json" | "netscape") => {
      setIsExporting(true);
      try {
        const content = await invoke<string>("export_profile_cookies", {
          profileId: profile.id,
          format,
        });
        const ext = format === "json" ? "json" : "txt";
        const filePath = await save({
          defaultPath: `${profile.name}_cookies.${ext}`,
          filters: [
            {
              name: format === "json" ? "JSON" : "Text",
              extensions: [ext],
            },
          ],
        });
        if (!filePath) return;
        await writeTextFile(filePath, content);
        showSuccessToast(t("cookies.export.success"));
      } catch (e) {
        showErrorToast(translateBackendError(t as never, e));
      } finally {
        setIsExporting(false);
      }
    },
    [profile.id, profile.name, t],
  );

  const domains = stats?.domains ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <LuCookie className="size-4" />
          {t("profileInfo.sections.cookies")}
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5"
                disabled={
                  isDisabled ||
                  isRunning ||
                  isExporting ||
                  !stats ||
                  stats.total_count === 0
                }
              >
                <LuDownload className="size-3.5" />
                {t("common.buttons.export")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  void handleExport("json");
                }}
              >
                {t("cookies.export.json")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  void handleExport("netscape");
                }}
              >
                {t("cookies.export.netscape")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {onImportCookies && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5"
              disabled={isDisabled || isRunning}
              onClick={onImportCookies}
            >
              <LuUpload className="size-3.5" />
              {t("common.buttons.import")}
            </Button>
          )}
          {onCopyCookies && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5"
              disabled={isDisabled}
              onClick={onCopyCookies}
            >
              <LuCopy className="size-3.5" />
              {t("common.buttons.copy")}
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("profileInfo.sectionDesc.cookies")}
      </p>
      {isRunning ? (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
          <p className="text-xs text-muted-foreground">
            {t("profileInfo.cookies.runningNotice")}
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
            <p className="text-[10px] tracking-wide text-muted-foreground uppercase">
              {t("profileInfo.fields.cookieCount")}
            </p>
            <p className="mt-0.5 text-sm">
              {isLoading
                ? t("profileInfo.values.loading")
                : stats
                  ? stats.total_count.toLocaleString()
                  : "—"}
            </p>
          </div>
          {domains.length > 0 && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-muted/40">
              <p className="shrink-0 border-b border-border px-3 py-2 text-[10px] tracking-wide text-muted-foreground uppercase">
                {t("profileInfo.cookies.domainsHeader", {
                  count: domains.length,
                })}
              </p>
              <ul className="flex-1 space-y-1 overflow-y-auto px-3 py-2 text-xs">
                {domains.map((d) => (
                  <li
                    key={d.domain}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate font-mono">{d.domain}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {d.count}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </>
      )}
    </div>
  );
}
