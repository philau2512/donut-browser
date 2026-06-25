"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type RowData,
  type RowSelectionState,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import type { Dispatch, SetStateAction } from "react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { FaApple, FaLinux, FaWindows } from "react-icons/fa";
import { FiMoreVertical, FiWifi } from "react-icons/fi";
import {
  LuCheck,
  LuChevronDown,
  LuChevronUp,
  LuCookie,
  LuInfo,
  LuPlay,
  LuPlus,
  LuPuzzle,
  LuSquare,
  LuTrash2,
  LuUsers,
} from "react-icons/lu";
import {
  ProfileBypassRulesDialog,
  ProfileDnsBlocklistDialog,
  ProfileInfoDialog,
  ProfileLaunchHookDialog,
} from "@/components/profile";
import {
  DeleteConfirmationDialog,
  MultipleSelector,
  type Option,
  TrafficDetailsDialog,
} from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PopoverTrigger } from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useBrowserState } from "@/hooks/use-browser-state";
import { useCloudAuth } from "@/hooks/use-cloud-auth";
import { useProxyEvents } from "@/hooks/use-proxy-events";
import { useScrollFade } from "@/hooks/use-scroll-fade";
import { useTableSorting } from "@/hooks/use-table-sorting";
import { useTeamLocks } from "@/hooks/use-team-locks";
import { useVpnEvents } from "@/hooks/use-vpn-events";
import {
  getBrowserDisplayName,
  getOSDisplayName,
  getProfileIcon,
  isCrossOsProfile,
} from "@/lib/browser-utils";
import { formatRelativeTime, getFlagIconClass } from "@/lib/flag-utils";
import { cn } from "@/lib/utils";
import type {
  BrowserProfile,
  ExtensionGroup,
  LocationItem,
  ProxyCheckResult,
  StoredProxy,
  SyncSessionInfo,
  TrafficSnapshot,
  VpnConfig,
} from "@/types";
import { Input } from "../ui/input";

declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    // Emit no width for this column so table-fixed hands it all remaining
    // space. Checking columnDef.size alone can't express this: TanStack
    // resolves an unspecified size to its 150px default.
    flexWidth?: boolean;
  }
}

// Stable table meta type to pass volatile state/handlers into TanStack Table without
// causing column definitions to be recreated on every render.
interface TableMeta {
  t: (key: string, options?: Record<string, unknown>) => string;
  selectedProfiles: string[];
  selectableCount: number;
  showCheckboxes: boolean;
  isClient: boolean;
  runningProfiles: Set<string>;
  launchingProfiles: Set<string>;
  stoppingProfiles: Set<string>;
  isUpdating: (browser: string) => boolean;
  browserState: ReturnType<typeof useBrowserState>;

  // Tags editor state
  tagsOverrides: Record<string, string[]>;
  allTags: string[];
  openTagsEditorFor: string | null;
  setAllTags: React.Dispatch<React.SetStateAction<string[]>>;
  setOpenTagsEditorFor: React.Dispatch<React.SetStateAction<string | null>>;
  setTagsOverrides: React.Dispatch<
    React.SetStateAction<Record<string, string[]>>
  >;

  // Note editor state
  noteOverrides: Record<string, string | null>;
  openNoteEditorFor: string | null;
  setOpenNoteEditorFor: React.Dispatch<React.SetStateAction<string | null>>;
  setNoteOverrides: React.Dispatch<
    React.SetStateAction<Record<string, string | null>>
  >;

  // Proxy selector state
  openProxySelectorFor: string | null;
  setOpenProxySelectorFor: React.Dispatch<React.SetStateAction<string | null>>;
  proxyOverrides: Record<string, string | null>;
  storedProxies: StoredProxy[];
  handleProxySelection: (
    profileId: string,
    proxyId: string | null,
  ) => void | Promise<void>;
  checkingProfileId: string | null;
  proxyCheckResults: Record<string, ProxyCheckResult>;

  // VPN selector state
  vpnConfigs: VpnConfig[];
  vpnOverrides: Record<string, string | null>;
  handleVpnSelection: (
    profileId: string,
    vpnId: string | null,
  ) => void | Promise<void>;

  // Extension groups (for Ext column lookup)
  extensionGroups: ExtensionGroup[];

  // Click handlers for inline Ext / DNS cell editing
  onAssignExtensionGroup?: (profileIds: string[]) => void;
  setDnsBlocklistProfile: React.Dispatch<
    React.SetStateAction<BrowserProfile | null>
  >;

  // Selection helpers
  isProfileSelected: (id: string) => boolean;
  handleToggleAll: (checked: boolean) => void;
  handleCheckboxChange: (id: string, checked: boolean) => void;
  handleIconClick: (id: string) => void;

  // Rename helpers
  handleRename: () => void | Promise<void>;
  setProfileToRename: React.Dispatch<
    React.SetStateAction<BrowserProfile | null>
  >;
  setNewProfileName: React.Dispatch<React.SetStateAction<string>>;
  setRenameError: React.Dispatch<React.SetStateAction<string | null>>;
  profileToRename: BrowserProfile | null;
  newProfileName: string;
  isRenamingSaving: boolean;
  renameError: string | null;

  // Launch/stop helpers
  setLaunchingProfiles: React.Dispatch<React.SetStateAction<Set<string>>>;
  setStoppingProfiles: React.Dispatch<React.SetStateAction<Set<string>>>;
  onKillProfile: (profile: BrowserProfile) => void | Promise<void>;
  onLaunchProfile: (profile: BrowserProfile) => void | Promise<void>;

  // Overflow actions
  onAssignProfilesToGroup?: (profileIds: string[]) => void;
  onConfigureCamoufox?: (profile: BrowserProfile) => void;
  onCloneProfile?: (profile: BrowserProfile) => void;
  onCopyCookiesToProfile?: (profile: BrowserProfile) => void;
  onOpenCookieManagement?: (profile: BrowserProfile) => void;
  onBulkProxyAssignment?: (profileIds: string[]) => void;
  onDeleteProfile?: (profile: BrowserProfile) => void;

  // Traffic snapshots (lightweight real-time data)
  trafficSnapshots: Record<string, TrafficSnapshot>;
  onOpenTrafficDialog?: (profileId: string) => void;

  // Sync
  syncStatuses: Record<string, { status: string; error?: string }>;
  onOpenProfileSyncDialog?: (profile: BrowserProfile) => void;
  onToggleProfileSync?: (profile: BrowserProfile) => void;
  crossOsUnlocked?: boolean;
  syncUnlocked?: boolean;

  // Country proxy creation (inline in proxy dropdown)
  countries: LocationItem[];
  canCreateLocationProxy: boolean;
  loadCountries: () => Promise<void>;
  handleCreateCountryProxy: (
    profileId: string,
    country: LocationItem,
  ) => Promise<void>;

  // Team locks
  isProfileLockedByAnother: (profileId: string) => boolean;
  getProfileLockEmail: (profileId: string) => string | undefined;

  // Synchronizer
  getProfileSyncInfo: (profileId: string) =>
    | {
        session: SyncSessionInfo;
        isLeader: boolean;
        failedAtUrl: string | null;
      }
    | undefined;
  onLaunchWithSync: (profile: BrowserProfile) => void;
}

interface SyncStatusDot {
  color: string;
  tooltip: string;
  animate: boolean;
  encrypted: boolean;
}

function _getProfileSyncStatusDot(
  profile: BrowserProfile,
  liveStatus:
    | "syncing"
    | "waiting"
    | "synced"
    | "error"
    | "disabled"
    | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
  errorMessage?: string,
): SyncStatusDot | null {
  const encrypted = profile.sync_mode === "Encrypted";
  const status =
    liveStatus ??
    (profile.sync_mode && profile.sync_mode !== "Disabled"
      ? "synced"
      : "disabled");

  switch (status) {
    case "syncing":
      return {
        color: "bg-warning",
        tooltip: t("profileTable.syncTooltipSyncing"),
        animate: true,
        encrypted,
      };
    case "waiting":
      return {
        color: "bg-warning",
        tooltip: t("profileTable.syncTooltipCloseToSync"),
        animate: false,
        encrypted,
      };
    case "synced":
      return {
        color: "bg-success",
        tooltip: profile.last_sync
          ? t("profileTable.syncTooltipSyncedAt", {
              time: new Date(profile.last_sync * 1000).toLocaleString(),
            })
          : t("profileTable.syncTooltipSynced"),
        animate: false,
        encrypted,
      };
    case "error":
      return {
        color: "bg-destructive",
        tooltip: errorMessage
          ? t("profileTable.syncTooltipErrorWith", { error: errorMessage })
          : t("profileTable.syncTooltipError"),
        animate: false,
        encrypted,
      };
    case "disabled":
      if (profile.last_sync) {
        return {
          color: "bg-muted-foreground",
          tooltip: t("profileTable.syncTooltipDisabledWithLast", {
            time: formatRelativeTime(profile.last_sync),
          }),
          animate: false,
          encrypted: false,
        };
      }
      return null;
    default:
      return null;
  }
}

const TagsCell = React.memo<{
  profile: BrowserProfile;
  isDisabled: boolean;
  tagsOverrides: Record<string, string[]>;
  allTags: string[];
  setAllTags: React.Dispatch<React.SetStateAction<string[]>>;
  openTagsEditorFor: string | null;
  setOpenTagsEditorFor: React.Dispatch<React.SetStateAction<string | null>>;
  setTagsOverrides: React.Dispatch<
    React.SetStateAction<Record<string, string[]>>
  >;
}>(
  ({
    profile,
    isDisabled,
    tagsOverrides,
    allTags,
    setAllTags,
    openTagsEditorFor,
    setOpenTagsEditorFor,
    setTagsOverrides,
  }) => {
    const { t: translate } = useTranslation();
    const effectiveTags: string[] = Object.hasOwn(tagsOverrides, profile.id)
      ? tagsOverrides[profile.id]
      : (profile.tags ?? []);

    const valueOptions: Option[] = React.useMemo(
      () => effectiveTags.map((t) => ({ value: t, label: t })),
      [effectiveTags],
    );
    const allOptions: Option[] = React.useMemo(
      () => allTags.map((t) => ({ value: t, label: t })),
      [allTags],
    );

    const onTagsChange = React.useCallback(
      async (newTagsRaw: string[]) => {
        // Dedupe tags
        const seen = new Set<string>();
        const newTags: string[] = [];
        for (const t of newTagsRaw) {
          if (!seen.has(t)) {
            seen.add(t);
            newTags.push(t);
          }
        }
        setTagsOverrides((prev) => ({ ...prev, [profile.id]: newTags }));
        try {
          await invoke<BrowserProfile>("update_profile_tags", {
            profileId: profile.id,
            tags: newTags,
          });
          setAllTags((prev) => {
            const next = new Set(prev);
            for (const t of newTags) next.add(t);
            return Array.from(next).sort();
          });
        } catch (error) {
          console.error("Failed to update tags:", error);
        }
      },
      [profile.id, setTagsOverrides, setAllTags],
    );

    const handleChange = React.useCallback(
      async (opts: Option[]) => {
        const newTagsRaw = opts.map((o) => o.value);
        await onTagsChange(newTagsRaw);
      },
      [onTagsChange],
    );

    const containerRef = React.useRef<HTMLDivElement | null>(null);
    const editorRef = React.useRef<HTMLDivElement | null>(null);
    const [visibleCount, setVisibleCount] = React.useState<number>(
      effectiveTags.length,
    );
    const [isFocused, setIsFocused] = React.useState(false);

    React.useLayoutEffect(() => {
      // Only measure when not editing this profile's tags
      if (openTagsEditorFor === profile.id) return;
      const container = containerRef.current;
      if (!container) return;

      let timeoutId: number | undefined;
      const compute = () => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = window.setTimeout(() => {
          const available = container.clientWidth;
          if (available <= 0) return;
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          const style = window.getComputedStyle(container);
          const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          ctx.font = font;
          const padding = 16;
          const gap = 4;
          let used = 0;
          let count = 0;
          for (let i = 0; i < effectiveTags.length; i++) {
            const text = effectiveTags[i];
            const width = Math.ceil(ctx.measureText(text).width) + padding;
            const remaining = effectiveTags.length - (i + 1);
            let extra = 0;
            if (remaining > 0) {
              const plusText = `+${remaining}`;
              extra = Math.ceil(ctx.measureText(plusText).width) + padding;
            }
            const nextUsed =
              used +
              (used > 0 ? gap : 0) +
              width +
              (remaining > 0 ? gap + extra : 0);
            if (nextUsed <= available) {
              used += (used > 0 ? gap : 0) + width;
              count = i + 1;
            } else {
              break;
            }
          }
          setVisibleCount(count);
        }, 16); // Debounce with RAF timing
      };
      compute();
      const ro = new ResizeObserver(compute);
      ro.observe(container);
      return () => {
        ro.disconnect();
        if (timeoutId) clearTimeout(timeoutId);
      };
    }, [effectiveTags, openTagsEditorFor, profile.id]);

    React.useEffect(() => {
      if (openTagsEditorFor !== profile.id) return;
      const handleClick = (e: MouseEvent) => {
        const target = e.target as Node | null;
        if (
          editorRef.current &&
          target &&
          !editorRef.current.contains(target)
        ) {
          setOpenTagsEditorFor(null);
        }
      };
      document.addEventListener("mousedown", handleClick);
      return () => {
        document.removeEventListener("mousedown", handleClick);
      };
    }, [openTagsEditorFor, profile.id, setOpenTagsEditorFor]);

    React.useEffect(() => {
      if (openTagsEditorFor === profile.id && editorRef.current) {
        // Focus the inner input of MultipleSelector on open
        const inputEl = editorRef.current.querySelector("input");
        if (inputEl) {
          inputEl.focus();
        }
      }
    }, [openTagsEditorFor, profile.id]);

    if (openTagsEditorFor !== profile.id) {
      const hiddenCount = Math.max(0, effectiveTags.length - visibleCount);
      const ButtonContent = (
        <button
          type="button"
          ref={containerRef as unknown as React.RefObject<HTMLButtonElement>}
          className={cn(
            "flex h-6 w-full cursor-pointer items-center gap-1 overflow-hidden rounded border-none bg-transparent px-2 py-1",
            isDisabled
              ? "cursor-not-allowed opacity-60"
              : "cursor-pointer hover:bg-accent/50",
          )}
          onClick={() => {
            if (!isDisabled) setOpenTagsEditorFor(profile.id);
          }}
        >
          {effectiveTags.slice(0, visibleCount).map((t) => (
            <Badge key={t} variant="secondary" className="px-2 py-0 text-xs">
              {t}
            </Badge>
          ))}
          {effectiveTags.length === 0 && (
            <span className="text-muted-foreground">
              {translate("profileTable.noTags")}
            </span>
          )}
          {hiddenCount > 0 && (
            <Badge variant="outline" className="px-2 py-0 text-xs">
              +{hiddenCount}
            </Badge>
          )}
        </button>
      );

      return (
        <div className="h-6 w-full cursor-pointer">
          <Tooltip>
            <TooltipTrigger asChild>{ButtonContent}</TooltipTrigger>
            {hiddenCount > 0 && (
              <TooltipContent className="max-w-[320px]">
                <div className="flex flex-wrap gap-1">
                  {effectiveTags.map((t) => (
                    <Badge
                      key={t}
                      variant="secondary"
                      className="px-2 py-0 text-xs"
                    >
                      {t}
                    </Badge>
                  ))}
                </div>
              </TooltipContent>
            )}
          </Tooltip>
        </div>
      );
    }

    return (
      <div
        className={cn(
          "relative h-6 w-full",
          isDisabled && "pointer-events-none opacity-60",
        )}
      >
        <div
          ref={editorRef}
          className="absolute top-0 left-0 z-50 min-h-6 w-40 rounded-md bg-popover shadow-md"
        >
          <MultipleSelector
            value={valueOptions}
            options={allOptions}
            onChange={(opts) => void handleChange(opts)}
            creatable
            selectFirstItem={false}
            placeholder={
              effectiveTags.length === 0
                ? translate("profileTable.addTagsPlaceholder")
                : ""
            }
            className={cn(
              "border-0! bg-transparent focus-within:ring-0!",
              "[&_div:first-child]:border-0! [&_div:first-child]:ring-0! [&_div:first-child]:focus-within:ring-0!",
              "[&_div:first-child]:min-h-6! [&_div:first-child]:px-2! [&_div:first-child]:py-1!",
              "[&_div:first-child>div]:h-6! [&_div:first-child>div]:items-center",
              "[&_input]:mt-0! [&_input]:ml-0! [&_input]:px-0!",
              !isFocused && "[&_div:first-child>div]:justify-center",
            )}
            badgeClassName="shrink-0"
            inputProps={{
              className: "!py-0 text-sm caret-current !ml-0 !mt-0 !px-0",
              onKeyDown: (e) => {
                if (e.key === "Escape") setOpenTagsEditorFor(null);
              },
              onFocus: () => {
                setIsFocused(true);
              },
              onBlur: () => {
                setIsFocused(false);
              },
            }}
          />
        </div>
      </div>
    );
  },
);

TagsCell.displayName = "TagsCell";

const NonHoverableTooltip = React.memo<{
  children: React.ReactNode;
  content: React.ReactNode;
  sideOffset?: number;
  alignOffset?: number;
  horizontalOffset?: number;
}>(
  ({
    children,
    content,
    sideOffset = 4,
    alignOffset = 0,
    horizontalOffset = 0,
  }) => {
    const [isOpen, setIsOpen] = React.useState(false);

    return (
      <Tooltip open={isOpen} onOpenChange={setIsOpen}>
        <TooltipTrigger
          asChild
          onMouseEnter={() => {
            setIsOpen(true);
          }}
          onMouseLeave={() => {
            setIsOpen(false);
          }}
        >
          {children}
        </TooltipTrigger>
        <TooltipContent
          sideOffset={sideOffset}
          alignOffset={alignOffset}
          arrowOffset={horizontalOffset}
          onPointerEnter={(e) => {
            e.preventDefault();
          }}
          onPointerLeave={() => {
            setIsOpen(false);
          }}
          className="pointer-events-none"
          style={
            horizontalOffset !== 0
              ? { transform: `translateX(${horizontalOffset}px)` }
              : undefined
          }
        >
          {content}
        </TooltipContent>
      </Tooltip>
    );
  },
);

NonHoverableTooltip.displayName = "NonHoverableTooltip";

// CSS-truncated text whose tooltip only appears when the text actually
// overflows its column (measured on hover, so it tracks live resizes).
const OverflowTooltipText = React.memo<{
  text: string;
  className?: string;
}>(({ text, className }) => {
  const textRef = React.useRef<HTMLSpanElement | null>(null);
  const [isOverflowing, setIsOverflowing] = React.useState(false);

  return (
    <Tooltip
      onOpenChange={(open) => {
        if (!open) return;
        const el = textRef.current;
        if (el) setIsOverflowing(el.scrollWidth > el.clientWidth);
      }}
    >
      <TooltipTrigger asChild>
        <span
          ref={textRef}
          className={cn("block max-w-full min-w-0 truncate", className)}
        >
          {text}
        </span>
      </TooltipTrigger>
      {isOverflowing && <TooltipContent>{text}</TooltipContent>}
    </Tooltip>
  );
});

OverflowTooltipText.displayName = "OverflowTooltipText";

// Must be rendered inside a <Popover>; the tooltip shows the full assignment
// name only when it is truncated in the cell.
const ProxyCellTrigger = React.memo<{
  displayName: string;
  hasAssignment: boolean;
  vpnBadge: string | null;
  isDisabled: boolean;
}>(({ displayName, hasAssignment, vpnBadge, isDisabled }) => {
  const textRef = React.useRef<HTMLSpanElement | null>(null);
  const [isOverflowing, setIsOverflowing] = React.useState(false);

  return (
    <Tooltip
      onOpenChange={(open) => {
        if (!open) return;
        const el = textRef.current;
        if (el) setIsOverflowing(el.scrollWidth > el.clientWidth);
      }}
    >
      <TooltipTrigger asChild>
        <PopoverTrigger asChild>
          <span
            className={cn(
              "flex max-w-full min-w-0 items-center gap-2 rounded px-2 py-1",
              isDisabled
                ? "pointer-events-none cursor-not-allowed opacity-60"
                : "cursor-pointer hover:bg-accent/50",
            )}
          >
            {vpnBadge && (
              <Badge
                variant="outline"
                className="shrink-0 px-1 py-0 text-[10px] leading-tight"
              >
                {vpnBadge}
              </Badge>
            )}
            <span
              ref={textRef}
              className={cn(
                "min-w-0 truncate text-sm",
                !hasAssignment && "text-muted-foreground",
              )}
            >
              {displayName}
            </span>
          </span>
        </PopoverTrigger>
      </TooltipTrigger>
      {hasAssignment && isOverflowing && (
        <TooltipContent>{displayName}</TooltipContent>
      )}
    </Tooltip>
  );
});

ProxyCellTrigger.displayName = "ProxyCellTrigger";

const NoteCell = React.memo<{
  profile: BrowserProfile;
  isDisabled: boolean;
  noteOverrides: Record<string, string | null>;
  openNoteEditorFor: string | null;
  setOpenNoteEditorFor: React.Dispatch<React.SetStateAction<string | null>>;
  setNoteOverrides: React.Dispatch<
    React.SetStateAction<Record<string, string | null>>
  >;
}>(
  ({
    profile,
    isDisabled,
    noteOverrides,
    openNoteEditorFor,
    setOpenNoteEditorFor,
    setNoteOverrides,
  }) => {
    const { t } = useTranslation();
    const effectiveNote: string | null = Object.hasOwn(
      noteOverrides,
      profile.id,
    )
      ? noteOverrides[profile.id]
      : (profile.note ?? null);

    const onNoteChange = React.useCallback(
      async (newNote: string | null) => {
        const trimmedNote = newNote?.trim() ?? null;
        setNoteOverrides((prev) => ({ ...prev, [profile.id]: trimmedNote }));
        try {
          await invoke<BrowserProfile>("update_profile_note", {
            profileId: profile.id,
            note: trimmedNote,
          });
        } catch (error) {
          console.error("Failed to update note:", error);
        }
      },
      [profile.id, setNoteOverrides],
    );

    const editorRef = React.useRef<HTMLDivElement | null>(null);
    const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
    const [noteValue, setNoteValue] = React.useState(effectiveNote ?? "");

    // Update local state when effective note changes (from outside)
    React.useEffect(() => {
      if (openNoteEditorFor !== profile.id) {
        setNoteValue(effectiveNote ?? "");
      }
    }, [effectiveNote, openNoteEditorFor, profile.id]);

    // Auto-resize textarea on open
    React.useEffect(() => {
      if (openNoteEditorFor === profile.id && textareaRef.current) {
        const textarea = textareaRef.current;
        textarea.style.height = "auto";
        textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
      }
    }, [openNoteEditorFor, profile.id]);

    const handleTextareaChange = React.useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newValue = e.target.value;
        setNoteValue(newValue);
        // Auto-resize
        const textarea = e.target;
        textarea.style.height = "auto";
        textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
      },
      [],
    );

    React.useEffect(() => {
      if (openNoteEditorFor !== profile.id) return;
      const handleClick = (e: MouseEvent) => {
        const target = e.target as Node | null;
        if (
          editorRef.current &&
          target &&
          !editorRef.current.contains(target)
        ) {
          const currentValue = textareaRef.current?.value ?? "";
          void onNoteChange(currentValue);
          setOpenNoteEditorFor(null);
        }
      };
      document.addEventListener("mousedown", handleClick);
      return () => {
        document.removeEventListener("mousedown", handleClick);
      };
    }, [openNoteEditorFor, profile.id, setOpenNoteEditorFor, onNoteChange]);

    React.useEffect(() => {
      if (openNoteEditorFor === profile.id && textareaRef.current) {
        textareaRef.current.focus();
        // Move cursor to end
        const len = textareaRef.current.value.length;
        textareaRef.current.setSelectionRange(len, len);
      }
    }, [openNoteEditorFor, profile.id]);

    const displayNote = effectiveNote ?? "";
    const showTooltip = displayNote.length > 0;

    if (openNoteEditorFor !== profile.id) {
      return (
        <div className="min-h-6 w-full">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex min-h-6 w-full min-w-0 items-center rounded border-none bg-transparent px-2 py-1 text-left",
                  isDisabled
                    ? "cursor-not-allowed opacity-60"
                    : "cursor-pointer hover:bg-accent/50",
                )}
                onClick={() => {
                  if (!isDisabled) {
                    setNoteValue(effectiveNote ?? "");
                    setOpenNoteEditorFor(profile.id);
                  }
                }}
              >
                <span
                  className={cn(
                    "block w-full truncate text-sm",
                    !effectiveNote && "text-muted-foreground",
                  )}
                >
                  {effectiveNote ? displayNote : t("profiles.note.empty")}
                </span>
              </button>
            </TooltipTrigger>
            {showTooltip && (
              <TooltipContent className="max-w-[320px]">
                <p className="wrap-break-word whitespace-pre-wrap">
                  {effectiveNote ?? t("profiles.note.empty")}
                </p>
              </TooltipContent>
            )}
          </Tooltip>
        </div>
      );
    }

    return (
      <div
        className={cn(
          "relative w-full",
          isDisabled && "pointer-events-none opacity-60",
        )}
      >
        <div
          ref={editorRef}
          className="absolute top-[-15px] -left-px z-50 min-h-6 w-60 rounded-md border bg-popover shadow-md"
        >
          <textarea
            ref={textareaRef}
            value={noteValue}
            onChange={handleTextareaChange}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setNoteValue(effectiveNote ?? "");
                setOpenNoteEditorFor(null);
              } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                void onNoteChange(noteValue);
                setOpenNoteEditorFor(null);
              }
            }}
            onBlur={() => {
              void onNoteChange(noteValue);
              setOpenNoteEditorFor(null);
            }}
            placeholder={t("profiles.note.placeholder")}
            className="max-h-[200px] min-h-6 w-full resize-none border-0 bg-transparent px-2 py-1 text-sm focus:ring-0 focus:outline-none"
            style={{
              overflow: "auto",
            }}
            rows={1}
          />
        </div>
      </div>
    );
  },
);

NoteCell.displayName = "NoteCell";

interface ProfilesDataTableProps {
  profiles: BrowserProfile[];
  onLaunchProfile: (profile: BrowserProfile) => void | Promise<void>;
  onKillProfile: (profile: BrowserProfile) => void | Promise<void>;
  onCloneProfile: (profile: BrowserProfile) => void | Promise<void>;
  onDeleteProfile: (profile: BrowserProfile) => void | Promise<void>;
  onRenameProfile: (profileId: string, newName: string) => Promise<void>;
  onConfigureCamoufox: (profile: BrowserProfile) => void;
  onCopyCookiesToProfile?: (profile: BrowserProfile) => void;
  onOpenCookieManagement?: (profile: BrowserProfile) => void;
  runningProfiles: Set<string>;
  isUpdating: (browser: string) => boolean;
  onDeleteSelectedProfiles: (profileIds: string[]) => Promise<void>;
  onAssignProfilesToGroup: (profileIds: string[]) => void;
  selectedGroupId: string | null;
  selectedProfiles: string[];
  onSelectedProfilesChange: Dispatch<SetStateAction<string[]>>;
  onBulkDelete?: () => void;
  onBulkGroupAssignment?: () => void;
  onBulkProxyAssignment?: () => void;
  onBulkCopyCookies?: () => void;
  onBulkRun?: () => void;
  onBulkStop?: () => void;
  bulkActionsUnlocked?: boolean;
  onBulkExtensionGroupAssignment?: () => void;
  onAssignExtensionGroup?: (profileIds: string[]) => void;
  onOpenProfileSyncDialog?: (profile: BrowserProfile) => void;
  onToggleProfileSync?: (profile: BrowserProfile) => void;
  crossOsUnlocked?: boolean;
  syncUnlocked?: boolean;
  getProfileSyncInfo?: (profileId: string) =>
    | {
        session: SyncSessionInfo;
        isLeader: boolean;
        failedAtUrl: string | null;
      }
    | undefined;
  onLaunchWithSync?: (profile: BrowserProfile) => void;
  onSetPassword?: (profile: BrowserProfile) => void;
  onChangePassword?: (profile: BrowserProfile) => void;
  onRemovePassword?: (profile: BrowserProfile) => void;
  /**
   * When provided, the info dialog is controlled by the parent. Allows the
   * command palette in page.tsx to open the dialog directly without lifting
   * every other piece of internal table state.
   */
  infoDialogProfile?: BrowserProfile | null;
  onInfoDialogProfileChange?: (profile: BrowserProfile | null) => void;
}

export function ProfilesDataTable({
  profiles,
  onLaunchProfile,
  onKillProfile,
  onCloneProfile,
  onDeleteProfile,
  onRenameProfile,
  onConfigureCamoufox,
  onCopyCookiesToProfile,
  onOpenCookieManagement,
  runningProfiles,
  isUpdating,
  onAssignProfilesToGroup,
  selectedProfiles,
  onSelectedProfilesChange,
  onBulkDelete,
  onBulkGroupAssignment,
  onBulkProxyAssignment,
  onBulkCopyCookies,
  onBulkRun,
  onBulkStop,
  bulkActionsUnlocked = false,
  onBulkExtensionGroupAssignment,
  onAssignExtensionGroup,
  onOpenProfileSyncDialog,
  onToggleProfileSync,
  crossOsUnlocked = false,
  syncUnlocked = false,
  getProfileSyncInfo,
  onLaunchWithSync,
  onSetPassword,
  onChangePassword,
  onRemovePassword,
  infoDialogProfile,
  onInfoDialogProfileChange,
}: ProfilesDataTableProps) {
  const { t } = useTranslation();
  const { getTableSorting, updateSorting, isLoaded } = useTableSorting();
  const [sorting, setSorting] = React.useState<SortingState>([]);

  // Sync external selectedProfiles with table's row selection state
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const prevSelectedProfilesRef = React.useRef<string[]>(selectedProfiles);

  // Update row selection when external selectedProfiles changes
  React.useEffect(() => {
    // Only update if selectedProfiles actually changed
    if (
      prevSelectedProfilesRef.current.length !== selectedProfiles.length ||
      !prevSelectedProfilesRef.current.every((id) =>
        selectedProfiles.includes(id),
      )
    ) {
      const newSelection: RowSelectionState = {};
      for (const profileId of selectedProfiles) {
        newSelection[profileId] = true;
      }
      setRowSelection(newSelection);
      prevSelectedProfilesRef.current = selectedProfiles;
      // When the parent clears the selection (e.g. after a bulk action like
      // delete / move-to-group), collapse the checkbox column back to icons.
      // Otherwise the row checkboxes stay visible and only revert after the
      // user clicks one — which the per-checkbox handler resets.
      if (selectedProfiles.length === 0) {
        setShowCheckboxes(false);
      }
    }
  }, [selectedProfiles]);

  // Update external selectedProfiles when table selection changes
  const handleRowSelectionChange = React.useCallback(
    (updater: React.SetStateAction<RowSelectionState>) => {
      setRowSelection((prevSelection) => {
        const newSelection =
          typeof updater === "function" ? updater(prevSelection) : updater;

        const selectedIds = Object.keys(newSelection).filter(
          (id) => newSelection[id],
        );

        // Only update external state if selection actually changed.
        // A Set gives O(1) membership; Array.includes() inside .every() would
        // be O(n*m) over large selections.
        const prevIdSet = new Set(
          Object.keys(prevSelection).filter((id) => prevSelection[id]),
        );

        if (
          selectedIds.length !== prevIdSet.size ||
          !selectedIds.every((id) => prevIdSet.has(id))
        ) {
          onSelectedProfilesChange(selectedIds);
        }

        return newSelection;
      });
    },
    [onSelectedProfilesChange],
  );
  const [profileToRename, setProfileToRename] =
    React.useState<BrowserProfile | null>(null);
  const [newProfileName, setNewProfileName] = React.useState("");
  const [renameError, setRenameError] = React.useState<string | null>(null);
  const [isRenamingSaving, setIsRenamingSaving] = React.useState(false);
  const renameContainerRef = React.useRef<HTMLDivElement | null>(null);
  const [profileToDelete, setProfileToDelete] =
    React.useState<BrowserProfile | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [internalInfoDialogProfile, setInternalInfoDialogProfile] =
    React.useState<BrowserProfile | null>(null);
  const isInfoDialogControlled = onInfoDialogProfileChange !== undefined;
  const profileForInfoDialog = isInfoDialogControlled
    ? (infoDialogProfile ?? null)
    : internalInfoDialogProfile;
  const setProfileForInfoDialog = React.useCallback(
    (p: BrowserProfile | null) => {
      if (isInfoDialogControlled) {
        onInfoDialogProfileChange?.(p);
      } else {
        setInternalInfoDialogProfile(p);
      }
    },
    [isInfoDialogControlled, onInfoDialogProfileChange],
  );
  const [bypassRulesProfile, setBypassRulesProfile] =
    React.useState<BrowserProfile | null>(null);
  const [dnsBlocklistProfile, setDnsBlocklistProfile] =
    React.useState<BrowserProfile | null>(null);
  const [launchHookProfile, setLaunchHookProfile] =
    React.useState<BrowserProfile | null>(null);
  const [launchingProfiles, setLaunchingProfiles] = React.useState<Set<string>>(
    new Set(),
  );
  const [stoppingProfiles, setStoppingProfiles] = React.useState<Set<string>>(
    new Set(),
  );

  const { storedProxies } = useProxyEvents();
  const { vpnConfigs } = useVpnEvents();
  const { user } = useCloudAuth();
  const { isProfileLocked, getLockInfo } = useTeamLocks(user?.id);

  const [proxyOverrides, setProxyOverrides] = React.useState<
    Record<string, string | null>
  >({});
  const [vpnOverrides, setVpnOverrides] = React.useState<
    Record<string, string | null>
  >({});
  const [showCheckboxes, setShowCheckboxes] = React.useState(false);
  const [tagsOverrides, setTagsOverrides] = React.useState<
    Record<string, string[]>
  >({});
  const [allTags, setAllTags] = React.useState<string[]>([]);
  const [openTagsEditorFor, setOpenTagsEditorFor] = React.useState<
    string | null
  >(null);
  const [openProxySelectorFor, setOpenProxySelectorFor] = React.useState<
    string | null
  >(null);
  const [checkingProfileId, _setCheckingProfileId] = React.useState<
    string | null
  >(null);
  const [proxyCheckResults, setProxyCheckResults] = React.useState<
    Record<string, ProxyCheckResult>
  >({});
  const [noteOverrides, setNoteOverrides] = React.useState<
    Record<string, string | null>
  >({});
  const [openNoteEditorFor, setOpenNoteEditorFor] = React.useState<
    string | null
  >(null);
  const [trafficSnapshots, setTrafficSnapshots] = React.useState<
    Record<string, TrafficSnapshot>
  >({});
  const [trafficDialogProfile, setTrafficDialogProfile] = React.useState<{
    id: string;
    name?: string;
  } | null>(null);
  const [syncStatuses, setSyncStatuses] = React.useState<
    Record<string, { status: string; error?: string }>
  >({});

  // Country proxy creation state (for inline proxy creation in dropdown)
  const [countries, setCountries] = React.useState<LocationItem[]>([]);
  const [countriesLoaded, setCountriesLoaded] = React.useState(false);

  // Extension groups for the Ext column lookup. Refreshed when the
  // backend emits 'extensions-changed' (group rename/create/delete).
  const [extensionGroups, setExtensionGroups] = React.useState<
    ExtensionGroup[]
  >([]);

  React.useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | undefined;
    const load = async () => {
      try {
        const data = await invoke<ExtensionGroup[]>("list_extension_groups");
        if (mounted) setExtensionGroups(data);
      } catch (e) {
        console.error("Failed to load extension groups:", e);
      }
    };
    void load();
    void listen("extensions-changed", () => {
      void load();
    }).then((u) => {
      if (mounted) unlisten = u;
      else u();
    });
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);
  const canCreateLocationProxy = false;

  const loadCountries = React.useCallback(async () => {
    if (countriesLoaded || !canCreateLocationProxy) return;
    try {
      const data = await invoke<LocationItem[]>("cloud_get_countries");
      setCountries(data);
      setCountriesLoaded(true);
    } catch (e) {
      console.error("Failed to load countries:", e);
    }
  }, [countriesLoaded]);

  // Load cached check results for proxies
  React.useEffect(() => {
    const loadCachedResults = async () => {
      const results: Record<string, ProxyCheckResult> = {};
      const proxyIds = new Set<string>();
      for (const profile of profiles) {
        if (profile.proxy_id) {
          proxyIds.add(profile.proxy_id);
        }
      }
      for (const proxyId of proxyIds) {
        try {
          const cached = await invoke<ProxyCheckResult | null>(
            "get_cached_proxy_check",
            { proxyId },
          );
          if (cached) {
            results[proxyId] = cached;
          }
        } catch (_error) {
          // Ignore errors
        }
      }
      setProxyCheckResults(results);
    };
    if (profiles.length > 0) {
      void loadCachedResults();
    }
  }, [profiles]);

  const loadAllTags = React.useCallback(async () => {
    try {
      const tags = await invoke<string[]>("get_all_tags");
      setAllTags(tags);
    } catch (error) {
      console.error("Failed to load tags:", error);
    }
  }, []);

  const handleProxySelection = React.useCallback(
    async (profileId: string, proxyId: string | null) => {
      try {
        await invoke("update_profile_proxy", {
          profileId,
          proxyId,
        });
        setProxyOverrides((prev) => ({ ...prev, [profileId]: proxyId }));
        setVpnOverrides((prev) => ({ ...prev, [profileId]: null }));
        await emit("profile-updated");
      } catch (error) {
        console.error("Failed to update proxy settings:", error);
      } finally {
        setOpenProxySelectorFor(null);
      }
    },
    [],
  );

  const handleVpnSelection = React.useCallback(
    async (profileId: string, vpnId: string | null) => {
      try {
        await invoke("update_profile_vpn", {
          profileId,
          vpnId,
        });
        setVpnOverrides((prev) => ({ ...prev, [profileId]: vpnId }));
        setProxyOverrides((prev) => ({ ...prev, [profileId]: null }));
        await emit("profile-updated");
      } catch (error) {
        console.error("Failed to update VPN settings:", error);
      } finally {
        setOpenProxySelectorFor(null);
      }
    },
    [],
  );

  const handleCreateCountryProxy = React.useCallback(
    async (profileId: string, country: LocationItem) => {
      try {
        await invoke("create_cloud_location_proxy", {
          name: country.name,
          country: country.code,
          region: null,
          city: null,
          isp: null,
        });
        await emit("stored-proxies-changed");
        // Wait briefly for proxy list to update, then find and assign the new proxy
        await new Promise((r) => setTimeout(r, 200));
        const updatedProxies =
          await invoke<StoredProxy[]>("get_stored_proxies");
        const newProxy = updatedProxies.find(
          (p: StoredProxy) =>
            p.is_cloud_derived && p.geo_country === country.code,
        );
        if (newProxy) {
          await handleProxySelection(profileId, newProxy.id);
        }
        setOpenProxySelectorFor(null);
      } catch (error) {
        console.error("Failed to create country proxy:", error);
      }
    },
    [handleProxySelection],
  );

  // Use shared browser state hook
  const browserState = useBrowserState(
    profiles,
    runningProfiles,
    isUpdating,
    launchingProfiles,
    stoppingProfiles,
  );

  // Listen for sync status events
  React.useEffect(() => {
    if (!browserState.isClient) return;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        unlisten = await listen<{
          profile_id: string;
          status: string;
          error?: string;
        }>("profile-sync-status", (event) => {
          const { profile_id, status, error } = event.payload;
          setSyncStatuses((prev) => ({
            ...prev,
            [profile_id]: { status, error },
          }));
        });
      } catch (error) {
        console.error("Failed to listen for sync status events:", error);
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, [browserState.isClient]);

  // Fetch traffic snapshots for running profiles (lightweight, real-time data)
  // Convert Set to sorted array to avoid Set reference comparison issues in dependencies
  const runningProfileIds = React.useMemo(
    () => Array.from(runningProfiles).sort(),
    [runningProfiles],
  );
  const runningCount = runningProfileIds.length;
  React.useEffect(() => {
    if (!browserState.isClient) return;

    if (runningCount === 0) {
      setTrafficSnapshots({});
      return;
    }

    const fetchTrafficSnapshots = async () => {
      try {
        const allSnapshots = await invoke<TrafficSnapshot[]>(
          "get_all_traffic_snapshots",
        );
        const newSnapshots: Record<string, TrafficSnapshot> = {};
        // O(1) membership; runningProfileIds.includes() in this loop would be
        // O(snapshots * runningProfiles).
        const runningSet = new Set(runningProfileIds);
        for (const snapshot of allSnapshots) {
          if (snapshot.profile_id) {
            // Only keep snapshots for profiles that are currently running
            if (runningSet.has(snapshot.profile_id)) {
              const existing = newSnapshots[snapshot.profile_id];
              if (!existing || snapshot.last_update > existing.last_update) {
                newSnapshots[snapshot.profile_id] = snapshot;
              }
            }
          }
        }
        setTrafficSnapshots(newSnapshots);
      } catch (error) {
        console.error("Failed to fetch traffic snapshots:", error);
      }
    };

    void fetchTrafficSnapshots();
    const interval = setInterval(() => {
      void fetchTrafficSnapshots();
    }, 1000);
    return () => {
      clearInterval(interval);
    };
  }, [browserState.isClient, runningCount, runningProfileIds]);

  // Clean up snapshots for profiles that are no longer running
  React.useEffect(() => {
    if (!browserState.isClient) return;

    setTrafficSnapshots((prev) => {
      const cleaned: Record<string, TrafficSnapshot> = {};
      const runningSet = new Set(runningProfileIds);
      for (const [profileId, snapshot] of Object.entries(prev)) {
        // Only keep snapshots for profiles that are currently running
        if (runningSet.has(profileId)) {
          cleaned[profileId] = snapshot;
        }
      }
      // Only update if something was removed
      if (Object.keys(cleaned).length !== Object.keys(prev).length) {
        return cleaned;
      }
      return prev;
    });
  }, [browserState.isClient, runningProfileIds]);

  // Clear launching/stopping spinners when backend reports running status changes
  React.useEffect(() => {
    if (!browserState.isClient) return;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        unlisten = await listen<{ id: string; is_running: boolean }>(
          "profile-running-changed",
          (event) => {
            const { id } = event.payload;
            // Clear launching state for this profile if present
            setLaunchingProfiles((prev) => {
              if (!prev.has(id)) return prev;
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
            // Clear stopping state for this profile if present
            setStoppingProfiles((prev) => {
              if (!prev.has(id)) return prev;
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
          },
        );
      } catch (error) {
        console.error("Failed to listen for profile running changes:", error);
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, [browserState.isClient]);

  // Keep stored proxies up-to-date by listening for changes emitted elsewhere in the app
  React.useEffect(() => {
    if (!browserState.isClient) return;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        unlisten = await listen("stored-proxies-changed", () => {
          // Also refresh tags on profile updates
          void loadAllTags();
        });
      } catch (_err) {
        // Best-effort only
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, [browserState.isClient, loadAllTags]);

  // Automatically deselect profiles that become running, updating, launching, or stopping
  React.useEffect(() => {
    const newSet = new Set(selectedProfiles);
    let hasChanges = false;

    for (const profileId of selectedProfiles) {
      const profile = profiles.find((p) => p.id === profileId);
      if (profile) {
        const isRunning =
          browserState.isClient && runningProfiles.has(profile.id);
        const isLaunching = launchingProfiles.has(profile.id);
        const isStopping = stoppingProfiles.has(profile.id);

        if (isRunning || isLaunching || isStopping) {
          newSet.delete(profileId);
          hasChanges = true;
        }
      }
    }

    if (hasChanges) {
      onSelectedProfilesChange(Array.from(newSet));
    }
  }, [
    profiles,
    runningProfiles,
    launchingProfiles,
    stoppingProfiles,
    browserState.isClient,
    onSelectedProfilesChange,
    selectedProfiles,
  ]);

  // Update local sorting state when settings are loaded
  React.useEffect(() => {
    if (isLoaded && browserState.isClient) {
      setSorting(getTableSorting());
    }
  }, [isLoaded, getTableSorting, browserState.isClient]);

  // Handle sorting changes
  const handleSortingChange = React.useCallback(
    (updater: React.SetStateAction<SortingState>) => {
      if (!browserState.isClient) return;
      const newSorting =
        typeof updater === "function" ? updater(sorting) : updater;
      setSorting(newSorting);
      updateSorting(newSorting);
    },
    [browserState.isClient, sorting, updateSorting],
  );

  const handleRename = React.useCallback(async () => {
    if (!profileToRename || !newProfileName.trim()) return;

    try {
      setIsRenamingSaving(true);
      await onRenameProfile(profileToRename.id, newProfileName.trim());
      setProfileToRename(null);
      setNewProfileName("");
      setRenameError(null);
    } catch (error) {
      setRenameError(
        error instanceof Error
          ? error.message
          : t("errors.renameProfileFailed", { error: String(error) }),
      );
    } finally {
      setIsRenamingSaving(false);
    }
  }, [profileToRename, newProfileName, onRenameProfile, t]);

  // Cancel inline rename on outside click
  React.useEffect(() => {
    if (!profileToRename) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        renameContainerRef.current &&
        !renameContainerRef.current.contains(target)
      ) {
        setProfileToRename(null);
        setNewProfileName("");
        setRenameError(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [profileToRename]);

  const handleDelete = async () => {
    if (!profileToDelete) return;

    setIsDeleting(true);
    // Minimum loading time for visual feedback
    const minLoadingTime = new Promise((r) => setTimeout(r, 300));
    try {
      await Promise.all([onDeleteProfile(profileToDelete), minLoadingTime]);
      setProfileToDelete(null);
    } catch (error) {
      console.error("Failed to delete profile:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  // Handle icon/checkbox click
  const handleIconClick = React.useCallback(
    (profileId: string) => {
      const profile = profiles.find((p) => p.id === profileId);
      if (!profile) return;

      // Prevent selection of profiles whose browsers are updating
      if (!browserState.canSelectProfile(profile)) {
        return;
      }

      setShowCheckboxes(true);
      const newSet = new Set(selectedProfiles);
      if (newSet.has(profileId)) {
        newSet.delete(profileId);
      } else {
        newSet.add(profileId);
      }

      // Hide checkboxes if no profiles are selected
      if (newSet.size === 0) {
        setShowCheckboxes(false);
      }

      onSelectedProfilesChange(Array.from(newSet));
    },
    [profiles, browserState, onSelectedProfilesChange, selectedProfiles],
  );

  React.useEffect(() => {
    if (browserState.isClient) {
      void loadAllTags();
    }
  }, [browserState.isClient, loadAllTags]);

  // Handle checkbox change
  const handleCheckboxChange = React.useCallback(
    (profileId: string, checked: boolean) => {
      const newSet = new Set(selectedProfiles);
      if (checked) {
        newSet.add(profileId);
      } else {
        newSet.delete(profileId);
      }

      // Hide checkboxes if no profiles are selected
      if (newSet.size === 0) {
        setShowCheckboxes(false);
      }

      onSelectedProfilesChange(Array.from(newSet));
    },
    [onSelectedProfilesChange, selectedProfiles],
  );

  // Handle select all checkbox
  const handleToggleAll = React.useCallback(
    (checked: boolean) => {
      const newSet = checked
        ? new Set(
            profiles
              .filter((profile) => {
                const isRunning =
                  browserState.isClient && runningProfiles.has(profile.id);
                const isLaunching = launchingProfiles.has(profile.id);
                const isStopping = stoppingProfiles.has(profile.id);
                return !isRunning && !isLaunching && !isStopping;
              })
              .map((profile) => profile.id),
          )
        : new Set<string>();

      setShowCheckboxes(checked);
      onSelectedProfilesChange(Array.from(newSet));
    },
    [
      profiles,
      onSelectedProfilesChange,
      browserState.isClient,
      runningProfiles,
      launchingProfiles,
      stoppingProfiles,
    ],
  );

  // Memoize selectableProfiles calculation
  const selectableProfiles = React.useMemo(() => {
    return profiles.filter((profile) => {
      const isRunning =
        browserState.isClient && runningProfiles.has(profile.id);
      const isLaunching = launchingProfiles.has(profile.id);
      const isStopping = stoppingProfiles.has(profile.id);
      return !isRunning && !isLaunching && !isStopping;
    });
  }, [
    profiles,
    browserState.isClient,
    runningProfiles,
    launchingProfiles,
    stoppingProfiles,
  ]);

  // Build table meta from volatile state so columns can stay stable
  const tableMeta = React.useMemo<TableMeta>(
    () => ({
      t,
      selectedProfiles,
      selectableCount: selectableProfiles.length,
      showCheckboxes,
      isClient: browserState.isClient,
      runningProfiles,
      launchingProfiles,
      stoppingProfiles,
      isUpdating,
      browserState,

      // Tags editor state
      tagsOverrides,
      allTags,
      openTagsEditorFor,
      setAllTags,
      setOpenTagsEditorFor,
      setTagsOverrides,

      // Note editor state
      noteOverrides,
      openNoteEditorFor,
      setOpenNoteEditorFor,
      setNoteOverrides,

      // Proxy selector state
      openProxySelectorFor,
      setOpenProxySelectorFor,
      proxyOverrides,
      storedProxies,
      handleProxySelection,
      checkingProfileId,
      proxyCheckResults,

      // VPN selector state
      vpnConfigs,
      vpnOverrides,
      handleVpnSelection,

      // Extension groups
      extensionGroups,
      onAssignExtensionGroup,
      setDnsBlocklistProfile,

      // Selection helpers
      isProfileSelected: (id: string) => selectedProfiles.includes(id),
      handleToggleAll,
      handleCheckboxChange,
      handleIconClick,

      // Rename helpers
      handleRename,
      setProfileToRename,
      setNewProfileName,
      setRenameError,
      profileToRename,
      newProfileName,
      isRenamingSaving,
      renameError,

      // Launch/stop helpers
      setLaunchingProfiles,
      setStoppingProfiles,
      onKillProfile,
      onLaunchProfile,

      // Overflow actions
      onAssignProfilesToGroup,
      onCloneProfile: onCloneProfile
        ? (profile: BrowserProfile) => {
            void onCloneProfile(profile);
          }
        : undefined,
      onConfigureCamoufox,
      onCopyCookiesToProfile,
      onOpenCookieManagement,

      // Traffic snapshots (lightweight real-time data)
      trafficSnapshots,
      onOpenTrafficDialog: (profileId: string) => {
        const profile = profiles.find((p) => p.id === profileId);
        setTrafficDialogProfile({ id: profileId, name: profile?.name });
      },

      // Sync
      syncStatuses,
      onOpenProfileSyncDialog,
      onToggleProfileSync,
      crossOsUnlocked,
      syncUnlocked,

      // Country proxy creation
      countries,
      canCreateLocationProxy,
      loadCountries,
      handleCreateCountryProxy,

      // Team locks
      isProfileLockedByAnother: isProfileLocked,
      getProfileLockEmail: (profileId: string) =>
        getLockInfo(profileId)?.lockedByEmail,

      // Synchronizer
      getProfileSyncInfo: getProfileSyncInfo ?? (() => undefined),
      onLaunchWithSync:
        onLaunchWithSync ??
        (() => {
          /* empty */
        }),
    }),
    [
      t,
      selectedProfiles,
      selectableProfiles.length,
      showCheckboxes,
      browserState.isClient,
      runningProfiles,
      launchingProfiles,
      stoppingProfiles,
      isUpdating,
      browserState,
      tagsOverrides,
      allTags,
      openTagsEditorFor,
      noteOverrides,
      openNoteEditorFor,
      openProxySelectorFor,
      proxyOverrides,
      storedProxies,
      handleProxySelection,
      checkingProfileId,
      proxyCheckResults,
      vpnConfigs,
      vpnOverrides,
      handleVpnSelection,
      extensionGroups,
      onAssignExtensionGroup,
      handleToggleAll,
      handleCheckboxChange,
      handleIconClick,
      handleRename,
      profileToRename,
      newProfileName,
      isRenamingSaving,
      trafficSnapshots,
      profiles,
      renameError,
      onKillProfile,
      onLaunchProfile,
      onAssignProfilesToGroup,
      onCloneProfile,
      onConfigureCamoufox,
      onCopyCookiesToProfile,
      onOpenCookieManagement,
      syncStatuses,
      onOpenProfileSyncDialog,
      onToggleProfileSync,
      crossOsUnlocked,
      syncUnlocked,
      countries,
      loadCountries,
      handleCreateCountryProxy,
      isProfileLocked,
      getLockInfo,
      getProfileSyncInfo,
      onLaunchWithSync,
    ],
  );

  const columns: ColumnDef<BrowserProfile>[] = React.useMemo(
    () => [
      {
        id: "select",
        header: ({ table }) => {
          const meta = table.options.meta as TableMeta;
          return (
            <span>
              <Checkbox
                checked={
                  meta.selectedProfiles.length === meta.selectableCount &&
                  meta.selectableCount !== 0
                }
                onCheckedChange={(value) => {
                  meta.handleToggleAll(!!value);
                }}
                aria-label={t("common.aria.selectAll")}
                className="cursor-pointer"
              />
            </span>
          );
        },
        cell: ({ row, table }) => {
          const meta = table.options.meta as TableMeta;
          const profile = row.original;
          const isSelected = meta.isProfileSelected(profile.id);

          return (
            <span className="flex size-4 items-center justify-center">
              <Checkbox
                checked={isSelected}
                onCheckedChange={(value) => {
                  meta.handleCheckboxChange(profile.id, !!value);
                }}
                aria-label={t("common.aria.selectRow")}
                className="size-4"
              />
            </span>
          );
        },
        enableSorting: false,
        enableHiding: false,
        size: 28,
      },
      {
        accessorKey: "name",
        meta: { flexWidth: true },
        header: ({ table }) => {
          const meta = table.options.meta as TableMeta;
          const sort = table.getState().sorting[0];
          const isActive = (id: string, desc: boolean) =>
            sort?.id === id && !!sort.desc === desc;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="h-auto cursor-pointer justify-start p-0 text-left font-semibold hover:bg-transparent"
                >
                  {meta.t("common.labels.name")}
                  {isActive("name", false) ? (
                    <LuChevronUp className="ml-2 size-4" />
                  ) : isActive("name", true) ? (
                    <LuChevronDown className="ml-2 size-4" />
                  ) : (
                    <LuChevronDown className="ml-2 size-4 opacity-50" />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  onClick={() =>
                    table.setSorting([{ id: "name", desc: false }])
                  }
                >
                  {isActive("name", false) && (
                    <LuCheck className="mr-2 size-3.5" />
                  )}
                  {meta.t("profiles.sort.nameAsc")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => table.setSorting([{ id: "name", desc: true }])}
                >
                  {isActive("name", true) && (
                    <LuCheck className="mr-2 size-3.5" />
                  )}
                  {meta.t("profiles.sort.nameDesc")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    table.setSorting([{ id: "created_at", desc: true }])
                  }
                >
                  {isActive("created_at", true) && (
                    <LuCheck className="mr-2 size-3.5" />
                  )}
                  {meta.t("profiles.sort.newest")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    table.setSorting([{ id: "created_at", desc: false }])
                  }
                >
                  {isActive("created_at", false) && (
                    <LuCheck className="mr-2 size-3.5" />
                  )}
                  {meta.t("profiles.sort.oldest")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
        enableSorting: true,
        sortingFn: "alphanumeric",
        cell: ({ row, table }) => {
          const meta = table.options.meta as TableMeta;
          const profile = row.original as BrowserProfile;
          const rawName: string = row.getValue("name");
          const name = getBrowserDisplayName(rawName);
          const isEditing = meta.profileToRename?.id === profile.id;

          if (isEditing) {
            return (
              <div
                ref={renameContainerRef}
                className="relative overflow-visible"
              >
                <Input
                  autoFocus
                  value={meta.newProfileName}
                  onChange={(e) => {
                    meta.setNewProfileName(e.target.value);
                    if (meta.renameError) meta.setRenameError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !(e.metaKey || e.ctrlKey)) {
                      void meta.handleRename();
                    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      void meta.handleRename();
                    } else if (e.key === "Escape") {
                      meta.setProfileToRename(null);
                      meta.setNewProfileName("");
                      meta.setRenameError(null);
                    }
                  }}
                  onBlur={() => {
                    if (
                      meta.newProfileName.trim().length > 0 &&
                      meta.newProfileName.trim() !== profile.name
                    ) {
                      void meta.handleRename();
                    } else {
                      meta.setProfileToRename(null);
                      meta.setNewProfileName("");
                      meta.setRenameError(null);
                    }
                  }}
                  className="h-6 w-full max-w-full min-w-0 border-0 px-2 py-1 text-sm leading-none font-medium shadow-none focus-visible:ring-0"
                />
              </div>
            );
          }

          // Browser icon
          const BrowserIcon = getProfileIcon(profile);

          // OS icon
          const resolvedOs =
            profile.host_os ||
            profile.camoufox_config?.os ||
            profile.wayfern_config?.os;
          const OsIcon =
            resolvedOs === "macos"
              ? FaApple
              : resolvedOs === "windows"
                ? FaWindows
                : FaLinux;

          // Chromium/Firefox version major
          const versionMajor = profile.version
            ? profile.version.split(".")[0]
            : "142";

          // Flag info
          const effectiveProxyId = profile.proxy_id;
          const effectiveProxy = effectiveProxyId
            ? meta.storedProxies.find((p) => p.id === effectiveProxyId)
            : null;
          const countryCode = effectiveProxy?.geo_country;

          return (
            <div className="flex max-w-full min-w-0 items-center gap-3 overflow-hidden py-0.5">
              <button
                type="button"
                className={cn(
                  "h-6 max-w-[200px] truncate rounded border-none bg-transparent px-2 py-1 text-left shrink-0",
                  "cursor-pointer hover:bg-accent/50 text-sm font-medium",
                )}
                onClick={() => {
                  meta.setProfileToRename(profile);
                  meta.setNewProfileName(profile.name);
                  meta.setRenameError(null);
                }}
              >
                <OverflowTooltipText text={name} className="text-left" />
              </button>

              <div className="flex items-center gap-1.5 shrink-0 bg-secondary/50 border border-border px-2 py-0.5 rounded-md text-[10px] text-muted-foreground select-none">
                {/* Browser icon */}
                {BrowserIcon && (
                  <BrowserIcon className="size-3 text-foreground" />
                )}

                {/* OS and version */}
                <div className="flex flex-col items-center justify-center leading-none size-4 select-none">
                  {OsIcon && <OsIcon className="size-2.5 text-foreground" />}
                  <span className="text-[7px] mt-0.5 scale-90">
                    {versionMajor}
                  </span>
                </div>

                {/* Dotted connector */}
                <span className="w-3 border-t border-dashed border-muted-foreground/30 mx-0.5" />

                {/* Flag icon */}
                {countryCode ? (
                  <button
                    type="button"
                    className="size-3 cursor-pointer hover:opacity-80 transition-opacity border-none p-0 bg-transparent flex items-center justify-center shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      meta.onBulkProxyAssignment?.([profile.id]);
                    }}
                    title={countryCode}
                  >
                    <span
                      className={cn(
                        "size-3 rounded-xs shrink-0 inline-block",
                        getFlagIconClass(countryCode),
                      )}
                    />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="size-3 hover:text-foreground flex items-center justify-center cursor-pointer transition-colors border-none p-0 bg-transparent text-muted-foreground/40"
                    onClick={(e) => {
                      e.stopPropagation();
                      meta.onBulkProxyAssignment?.([profile.id]);
                    }}
                    title={meta.t("profiles.table.changeProxy")}
                  >
                    <FiWifi className="size-3" />
                  </button>
                )}

                {/* Dotted connector */}
                <span className="w-3 border-t border-dashed border-muted-foreground/30 mx-0.5" />

                {/* Quick proxy change button */}
                <button
                  type="button"
                  className="size-3.5 hover:bg-accent hover:text-foreground rounded flex items-center justify-center cursor-pointer transition-colors border-none p-0 bg-transparent text-muted-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    meta.onBulkProxyAssignment?.([profile.id]);
                  }}
                  title={meta.t("profiles.table.changeProxy")}
                >
                  <LuPlus className="size-2.5" />
                </button>
              </div>
            </div>
          );
        },
      },
      {
        id: "tags",
        size: 100,
        header: ({ table }) => {
          const meta = table.options.meta as TableMeta;
          return meta.t("profileTable.tagsHeader");
        },
        cell: ({ row, table }) => {
          const meta = table.options.meta as TableMeta;
          const profile = row.original;
          const isCrossOs = isCrossOsProfile(profile);
          const isCrossOsBlocked = isCrossOs;
          const isRunning =
            meta.isClient && meta.runningProfiles.has(profile.id);
          const isLaunching = meta.launchingProfiles.has(profile.id);
          const isStopping = meta.stoppingProfiles.has(profile.id);
          const isDisabled =
            isRunning || isLaunching || isStopping || isCrossOsBlocked;

          return (
            <TagsCell
              profile={profile}
              isDisabled={isDisabled}
              tagsOverrides={meta.tagsOverrides ?? {}}
              allTags={meta.allTags ?? []}
              setAllTags={meta.setAllTags}
              openTagsEditorFor={meta.openTagsEditorFor ?? null}
              setOpenTagsEditorFor={meta.setOpenTagsEditorFor}
              setTagsOverrides={meta.setTagsOverrides}
            />
          );
        },
      },
      {
        id: "note",
        size: 80,
        header: ({ table }) => {
          const meta = table.options.meta as TableMeta;
          return meta.t("profileTable.noteHeader");
        },
        cell: ({ row, table }) => {
          const meta = table.options.meta as TableMeta;
          const profile = row.original;
          const isCrossOs = isCrossOsProfile(profile);
          const isCrossOsBlocked = isCrossOs;
          const isRunning =
            meta.isClient && meta.runningProfiles.has(profile.id);
          const isLaunching = meta.launchingProfiles.has(profile.id);
          const isStopping = meta.stoppingProfiles.has(profile.id);
          const isDisabled =
            isRunning || isLaunching || isStopping || isCrossOsBlocked;

          return (
            <NoteCell
              profile={profile}
              isDisabled={isDisabled}
              noteOverrides={meta.noteOverrides ?? {}}
              openNoteEditorFor={meta.openNoteEditorFor ?? null}
              setOpenNoteEditorFor={meta.setOpenNoteEditorFor}
              setNoteOverrides={meta.setNoteOverrides}
            />
          );
        },
      },
      {
        id: "last_open",
        size: 110,
        header: ({ table }) => {
          const meta = table.options.meta as TableMeta;
          return meta.t("profiles.table.lastOpen");
        },
        cell: ({ row }) => {
          const profile = row.original;
          if (!profile.last_launch)
            return (
              <span className="text-muted-foreground/50 text-xs">---</span>
            );
          return (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="opacity-70 text-[10px]">⏱</span>
              <span>{formatRelativeTime(profile.last_launch)}</span>
            </div>
          );
        },
      },
      {
        id: "status",
        size: 90,
        header: ({ table }) => {
          const meta = table.options.meta as TableMeta;
          return meta.t("profiles.table.status");
        },
        cell: ({ row, table }) => {
          const meta = table.options.meta as TableMeta;
          const profile = row.original;
          const isRunning =
            meta.isClient && meta.runningProfiles.has(profile.id);
          const isLaunching = meta.launchingProfiles.has(profile.id);
          const isStopping = meta.stoppingProfiles.has(profile.id);

          let statusText = meta.t("profiles.status.ready");
          let statusStyle =
            "bg-success/15 text-success border border-success/30";

          if (isRunning) {
            statusText = meta.t("profiles.status.running");
            statusStyle =
              "bg-blue-500/15 text-blue-500 border border-blue-500/30";
          } else if (isLaunching) {
            statusText = meta.t("profiles.status.launching");
            statusStyle =
              "bg-warning/15 text-warning border border-warning/30 animate-pulse";
          } else if (isStopping) {
            statusText = meta.t("profiles.status.stopping");
            statusStyle =
              "bg-destructive/15 text-destructive border border-destructive/30";
          } else if (!profile.last_launch) {
            statusText = meta.t("profiles.status.noStatus");
            statusStyle = "bg-muted text-muted-foreground border border-border";
          }

          return (
            <Badge
              className={cn(
                "px-2 py-0.5 rounded-sm text-[10px] font-medium shadow-none select-none",
                statusStyle,
              )}
            >
              {statusText}
            </Badge>
          );
        },
      },
      {
        id: "message",
        size: 100,
        header: ({ table }) => {
          const meta = table.options.meta as TableMeta;
          return meta.t("profiles.table.message");
        },
        cell: ({ row, table }) => {
          const meta = table.options.meta as TableMeta;
          const profile = row.original;
          const isRunning =
            meta.isClient && meta.runningProfiles.has(profile.id);
          const isLaunching = meta.launchingProfiles.has(profile.id);
          const isStopping = meta.stoppingProfiles.has(profile.id);

          let msg = "Ready";
          if (isRunning) msg = "Running";
          else if (isLaunching) msg = "Launching...";
          else if (isStopping) msg = "Stopping...";

          return (
            <span className="text-xs text-muted-foreground truncate max-w-full block">
              {msg}
            </span>
          );
        },
      },
      {
        id: "actions",
        size: 110,
        header: ({ table }) => {
          const meta = table.options.meta as TableMeta;
          return meta.t("profiles.table.actions");
        },
        cell: ({ row, table }) => {
          const meta = table.options.meta as TableMeta;
          const profile = row.original;
          const isRunning =
            meta.isClient && meta.runningProfiles.has(profile.id);
          const isLaunching = meta.launchingProfiles.has(profile.id);
          const isStopping = meta.stoppingProfiles.has(profile.id);
          const isLockedByAnother = meta.isProfileLockedByAnother(profile.id);
          const isSyncing = meta.syncStatuses[profile.id]?.status === "syncing";
          const canLaunch =
            meta.browserState.canLaunchProfile(profile) &&
            !isLockedByAnother &&
            !isSyncing;

          const handleProfileStop = async (profile: BrowserProfile) => {
            meta.setStoppingProfiles((prev) => new Set(prev).add(profile.id));
            try {
              await meta.onKillProfile(profile);
            } catch (error) {
              meta.setStoppingProfiles((prev) => {
                const next = new Set(prev);
                next.delete(profile.id);
                return next;
              });
              throw error;
            }
          };

          const handleProfileLaunch = async (profile: BrowserProfile) => {
            meta.setLaunchingProfiles((prev) => new Set(prev).add(profile.id));
            try {
              await meta.onLaunchProfile(profile);
            } catch (error) {
              meta.setLaunchingProfiles((prev) => {
                const next = new Set(prev);
                next.delete(profile.id);
                return next;
              });
              throw error;
            }
          };

          const handleStop = async () => {
            const syncInfo = meta.getProfileSyncInfo(profile.id);
            if (syncInfo?.isLeader) {
              await invoke("stop_sync_session", {
                sessionId: syncInfo.session.id,
              });
            } else if (syncInfo?.isLeader === false) {
              await invoke("remove_sync_follower", {
                sessionId: syncInfo.session.id,
                followerProfileId: profile.id,
              });
            } else {
              await handleProfileStop(profile);
            }
          };

          return (
            <div className="flex items-center justify-end gap-1.5 w-full">
              <Button
                size="sm"
                variant={isRunning ? "destructive" : "default"}
                disabled={!canLaunch || isLaunching || isStopping}
                onClick={() =>
                  isRunning
                    ? void handleStop()
                    : void handleProfileLaunch(profile)
                }
                className={cn(
                  "h-7 px-3 text-xs font-semibold gap-1 shrink-0 shadow-none cursor-pointer",
                  isRunning
                    ? "bg-orange-600 hover:bg-orange-700 text-white"
                    : "bg-blue-600 hover:bg-blue-700 text-white",
                )}
              >
                {isLaunching || isStopping ? (
                  <div className="size-3 animate-spin rounded-full border border-current border-t-transparent" />
                ) : isRunning ? (
                  <>
                    <LuSquare className="size-3 fill-current" />
                    {meta.t("profiles.actions.stop")}
                  </>
                ) : (
                  <>
                    <LuPlay className="size-3 fill-current" />
                    {meta.t("profiles.actions.launch")}
                  </>
                )}
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 p-0 hover:bg-accent cursor-pointer shrink-0"
                  >
                    <span className="sr-only">Menu</span>
                    <FiMoreVertical className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem
                    onClick={() => {
                      meta.setProfileToRename(profile);
                      meta.setNewProfileName(profile.name);
                      meta.setRenameError(null);
                    }}
                  >
                    {meta.t("profiles.menu.rename")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setProfileForInfoDialog(profile)}
                  >
                    {meta.t("profiles.menu.edit")}
                  </DropdownMenuItem>
                  {meta.onCopyCookiesToProfile && (
                    <DropdownMenuItem
                      onClick={() => meta.onCopyCookiesToProfile?.(profile)}
                    >
                      {meta.t("profiles.menu.copyCookies")}
                    </DropdownMenuItem>
                  )}
                  {meta.onOpenCookieManagement && (
                    <DropdownMenuItem
                      onClick={() => meta.onOpenCookieManagement?.(profile)}
                    >
                      {meta.t("profiles.menu.manageCookies")}
                    </DropdownMenuItem>
                  )}
                  {meta.onCloneProfile && (
                    <DropdownMenuItem
                      onClick={() => meta.onCloneProfile?.(profile)}
                    >
                      {meta.t("profiles.menu.clone")}
                    </DropdownMenuItem>
                  )}
                  {meta.onAssignProfilesToGroup && (
                    <DropdownMenuItem
                      onClick={() =>
                        meta.onAssignProfilesToGroup?.([profile.id])
                      }
                    >
                      {meta.t("profiles.menu.assignGroup")}
                    </DropdownMenuItem>
                  )}
                  {meta.onAssignExtensionGroup && (
                    <DropdownMenuItem
                      onClick={() =>
                        meta.onAssignExtensionGroup?.([profile.id])
                      }
                    >
                      {meta.t("profiles.menu.assignExtension")}
                    </DropdownMenuItem>
                  )}
                  {meta.onConfigureCamoufox &&
                    profile.browser === "camoufox" && (
                      <DropdownMenuItem
                        onClick={() => meta.onConfigureCamoufox?.(profile)}
                      >
                        {meta.t("profiles.menu.configureCamoufox")}
                      </DropdownMenuItem>
                    )}
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => meta.onDeleteProfile?.(profile)}
                  >
                    {meta.t("common.buttons.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      },
    ],
    [t, setProfileForInfoDialog],
  );

  // Low-priority columns leave the table as the container narrows (most
  // expendable first); their data stays reachable via the profile info
  // dialog. Visibility (not CSS hiding) so table-fixed reclaims the width.
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({ created_at: false });

  // Content columns grow proportionally with the container but never drop
  // below the compact-layout floor; the name column takes the remainder.
  // Computed in px from the observed container width because fixed table
  // layout ignores max()/calc() column widths.
  const [containerWidth, setContainerWidth] = React.useState(0);

  const table = useReactTable({
    data: profiles,
    columns,
    state: {
      sorting,
      rowSelection,
      columnVisibility,
    },
    onSortingChange: handleSortingChange,
    onRowSelectionChange: handleRowSelectionChange,
    onColumnVisibilityChange: setColumnVisibility,
    enableRowSelection: (row) => {
      const profile = row.original;
      const isRunning =
        browserState.isClient && runningProfiles.has(profile.id);
      const isLaunching = launchingProfiles.has(profile.id);
      const isStopping = stoppingProfiles.has(profile.id);
      return !isRunning && !isLaunching && !isStopping;
    },
    getSortedRowModel: getSortedRowModel(),
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    meta: tableMeta,
  });

  const scrollParentRef = React.useRef<HTMLDivElement | null>(null);
  const columnWidth = React.useCallback(
    (id: string, sizePx: number) => {
      const proportions: Record<string, { pct: number; floor: number }> = {
        tags: { pct: 0.12, floor: 100 },
        note: { pct: 0.1, floor: 80 },
        proxy: { pct: 0.13, floor: 110 },
        ext: { pct: 0.11, floor: 95 },
        dns: { pct: 0.11, floor: 95 },
      };
      const p = proportions[id];
      if (!p) return `${sizePx}px`;
      return `${Math.max(p.floor, Math.round(containerWidth * p.pct))}px`;
    },
    [containerWidth],
  );
  const sortedRows = table.getRowModel().rows;
  useScrollFade(scrollParentRef);

  React.useEffect(() => {
    const el = scrollParentRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      setContainerWidth(Math.round(w / 8) * 8);
      setColumnVisibility((prev) => {
        const next: VisibilityState = {
          // Always hidden — sort-only column (issue #454).
          created_at: false,
          dns: w >= 768,
          ext: w >= 672,
          note: w >= 576,
          tags: w >= 512,
        };
        return Object.keys(next).every((k) => prev[k] === next[k])
          ? prev
          : next;
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  // Compact 36px row from the redesign spec; estimateSize must match the
  // actual rendered row height or virtualizer placement drifts under scroll.
  const ROW_HEIGHT = 36;

  const rowVirtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? totalSize - virtualRows[virtualRows.length - 1].end
      : 0;

  const selectedCount = selectedProfiles.length;

  return (
    <>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* Bulk Actions Toolbar */}
        <div className="flex flex-wrap items-center gap-2 pb-3 pt-1 border-b border-border mb-3 select-none">
          <Button
            size="sm"
            disabled={selectedCount === 0}
            onClick={bulkActionsUnlocked && onBulkRun ? onBulkRun : undefined}
            className={cn(
              "h-8 text-xs font-semibold gap-1.5 cursor-pointer shrink-0 shadow-none text-white",
              selectedCount > 0
                ? "bg-blue-600 hover:bg-blue-700"
                : "bg-muted text-muted-foreground cursor-not-allowed opacity-50",
            )}
          >
            <LuPlay className="size-3.5 fill-current" />
            {selectedCount > 0
              ? t("profiles.actionBar.startCount", { count: selectedCount })
              : t("profiles.actionBar.start")}
          </Button>

          <Button
            size="sm"
            disabled={selectedCount === 0}
            onClick={bulkActionsUnlocked && onBulkStop ? onBulkStop : undefined}
            className={cn(
              "h-8 text-xs font-semibold gap-1.5 cursor-pointer shrink-0 shadow-none text-white",
              selectedCount > 0
                ? "bg-orange-600 hover:bg-orange-700"
                : "bg-muted text-muted-foreground cursor-not-allowed opacity-50",
            )}
          >
            <LuSquare className="size-3.5 fill-current" />
            {selectedCount > 0
              ? t("profiles.actionBar.stopCount", { count: selectedCount })
              : t("profiles.actionBar.stop")}
          </Button>

          <Button
            size="sm"
            variant="destructive"
            disabled={selectedCount === 0}
            onClick={onBulkDelete}
            className="h-8 text-xs font-semibold gap-1.5 cursor-pointer shrink-0 shadow-none"
          >
            <LuTrash2 className="size-3.5" />
            {t("common.buttons.delete")}
          </Button>

          <Button
            size="sm"
            disabled={selectedCount === 0 || !bulkActionsUnlocked}
            className={cn(
              "h-8 text-xs font-semibold gap-1.5 shrink-0 shadow-none text-white",
              selectedCount > 0 && bulkActionsUnlocked
                ? "bg-blue-600 hover:bg-blue-700 cursor-pointer"
                : "bg-muted text-muted-foreground cursor-not-allowed opacity-50",
            )}
          >
            <LuPlay className="size-3.5" />
            {t("profiles.actionBar.automation")}
          </Button>

          <Button
            size="sm"
            disabled={selectedCount === 0}
            onClick={onBulkProxyAssignment}
            className={cn(
              "h-8 text-xs font-semibold gap-1.5 shrink-0 shadow-none text-white",
              selectedCount > 0
                ? "bg-blue-600 hover:bg-blue-700 cursor-pointer"
                : "bg-muted text-muted-foreground cursor-not-allowed opacity-50",
            )}
          >
            <LuInfo className="size-3.5" />
            {t("profiles.actionBar.updateMultiple")}
          </Button>

          <Button
            size="sm"
            disabled={selectedCount === 0}
            onClick={onBulkProxyAssignment}
            className={cn(
              "h-8 text-xs font-semibold gap-1.5 shrink-0 shadow-none text-white",
              selectedCount > 0
                ? "bg-blue-600 hover:bg-blue-700 cursor-pointer"
                : "bg-muted text-muted-foreground cursor-not-allowed opacity-50",
            )}
          >
            <FiWifi className="size-3.5" />
            {t("profiles.actionBar.proxy")}
          </Button>

          <Button
            size="sm"
            disabled={selectedCount === 0}
            onClick={onBulkCopyCookies}
            className={cn(
              "h-8 text-xs font-semibold gap-1.5 shrink-0 shadow-none text-white",
              selectedCount > 0
                ? "bg-blue-600 hover:bg-blue-700 cursor-pointer"
                : "bg-muted text-muted-foreground cursor-not-allowed opacity-50",
            )}
          >
            <LuCookie className="size-3.5" />
            {t("profiles.actionBar.exportCookies")}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                disabled={selectedCount === 0}
                className="h-8 text-xs font-semibold gap-1.5 border border-border cursor-pointer shrink-0"
              >
                {t("profiles.actionBar.moreAction")}
                <LuChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {onBulkGroupAssignment && (
                <DropdownMenuItem
                  onClick={onBulkGroupAssignment}
                  className="cursor-pointer"
                >
                  <LuUsers className="mr-2 size-4" />
                  {t("profiles.actionBar.assignToGroup")}
                </DropdownMenuItem>
              )}
              {onBulkExtensionGroupAssignment && (
                <DropdownMenuItem
                  onClick={onBulkExtensionGroupAssignment}
                  className="cursor-pointer"
                >
                  <LuPuzzle className="mr-2 size-4" />
                  {t("profiles.actionBar.assignExtensionGroup")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div
          ref={scrollParentRef}
          className={cn("scroll-fade relative min-h-0 flex-1 overflow-auto")}
          style={
            {
              // Sticky table header is 32px tall (h-8); shift the top
              // fade band below it so the header stays fully opaque and
              // only body rows fade as they scroll past.
              "--scroll-fade-top-offset": "32px",
            } as React.CSSProperties
          }
        >
          <Table className="table-fixed" containerClassName="overflow-visible">
            <TableHeader className="sticky top-0 z-10 overflow-visible bg-background [&_tr]:border-0">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow
                  key={headerGroup.id}
                  className="overflow-visible border-0!"
                >
                  {headerGroup.headers.map((header) => {
                    return (
                      <TableHead
                        key={header.id}
                        style={{
                          width: header.column.columnDef.meta?.flexWidth
                            ? undefined
                            : columnWidth(
                                header.column.id,
                                header.column.getSize(),
                              ),
                        }}
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody className="overflow-visible">
              {sortedRows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={table.getVisibleLeafColumns().length}
                    className="h-24 text-center"
                  >
                    {t("profiles.table.empty")}
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {paddingTop > 0 && (
                    <tr style={{ height: `${paddingTop}px` }}>
                      <td colSpan={table.getVisibleLeafColumns().length} />
                    </tr>
                  )}
                  {virtualRows.map((virtualRow) => {
                    const row = sortedRows[virtualRow.index];
                    const rowIsCrossOs = isCrossOsProfile(row.original);
                    const crossOsTitle = rowIsCrossOs
                      ? t("crossOs.viewOnly", {
                          os: getOSDisplayName(
                            row.original.host_os ||
                              row.original.camoufox_config?.os ||
                              row.original.wayfern_config?.os ||
                              "",
                          ),
                        })
                      : undefined;
                    return (
                      <TableRow
                        key={row.id}
                        data-state={row.getIsSelected() && "selected"}
                        title={crossOsTitle}
                        style={{ height: `${ROW_HEIGHT}px` }}
                        className={cn(
                          "overflow-visible border-0! hover:bg-accent/50",
                          rowIsCrossOs && "opacity-60",
                        )}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <TableCell
                            key={cell.id}
                            className="overflow-visible py-0"
                            style={{
                              width: cell.column.columnDef.meta?.flexWidth
                                ? undefined
                                : columnWidth(
                                    cell.column.id,
                                    cell.column.getSize(),
                                  ),
                            }}
                          >
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext(),
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })}
                  {paddingBottom > 0 && (
                    <tr style={{ height: `${paddingBottom}px` }}>
                      <td colSpan={table.getVisibleLeafColumns().length} />
                    </tr>
                  )}
                </>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      <DeleteConfirmationDialog
        isOpen={profileToDelete !== null}
        onClose={() => {
          setProfileToDelete(null);
        }}
        onConfirm={handleDelete}
        title={t("profiles.delete.title")}
        description={t("profiles.delete.description", {
          profileName: profileToDelete?.name ?? "",
        })}
        confirmButtonText={t("profiles.delete.confirmButton")}
        isLoading={isDeleting}
      />
      {profileForInfoDialog &&
        (() => {
          const infoProfile =
            profiles.find((p) => p.id === profileForInfoDialog.id) ??
            profileForInfoDialog;
          const infoIsRunning =
            browserState.isClient && runningProfiles.has(infoProfile.id);
          const infoIsLaunching = launchingProfiles.has(infoProfile.id);
          const infoIsStopping = stoppingProfiles.has(infoProfile.id);
          const infoIsCrossOs = isCrossOsProfile(infoProfile);
          const infoIsDisabled =
            infoIsRunning || infoIsLaunching || infoIsStopping || infoIsCrossOs;
          return (
            <ProfileInfoDialog
              isOpen={profileForInfoDialog !== null}
              onClose={() => {
                setProfileForInfoDialog(null);
              }}
              profile={infoProfile}
              storedProxies={storedProxies}
              vpnConfigs={vpnConfigs}
              onOpenTrafficDialog={(profileId) => {
                const profile = profiles.find((p) => p.id === profileId);
                setTrafficDialogProfile({ id: profileId, name: profile?.name });
              }}
              onOpenProfileSyncDialog={onOpenProfileSyncDialog}
              onAssignProfilesToGroup={onAssignProfilesToGroup}
              onConfigureCamoufox={onConfigureCamoufox}
              onCopyCookiesToProfile={onCopyCookiesToProfile}
              onOpenCookieManagement={onOpenCookieManagement}
              onAssignExtensionGroup={onAssignExtensionGroup}
              onOpenBypassRules={(profile) => {
                setBypassRulesProfile(profile);
              }}
              onOpenDnsBlocklist={(profile) => {
                setDnsBlocklistProfile(profile);
              }}
              onOpenLaunchHook={(profile) => {
                setLaunchHookProfile(profile);
              }}
              onCloneProfile={onCloneProfile}
              onLaunchWithSync={onLaunchWithSync}
              onSetPassword={onSetPassword}
              onChangePassword={onChangePassword}
              onRemovePassword={onRemovePassword}
              onDeleteProfile={(profile) => {
                setProfileForInfoDialog(null);
                setProfileToDelete(profile);
              }}
              crossOsUnlocked={crossOsUnlocked}
              isRunning={infoIsRunning}
              isDisabled={infoIsDisabled}
              isCrossOs={infoIsCrossOs}
              syncStatuses={syncStatuses}
            />
          );
        })()}

      {trafficDialogProfile && (
        <TrafficDetailsDialog
          isOpen={trafficDialogProfile !== null}
          onClose={() => {
            setTrafficDialogProfile(null);
          }}
          profileId={trafficDialogProfile.id}
          profileName={trafficDialogProfile.name}
        />
      )}
      <ProfileBypassRulesDialog
        isOpen={bypassRulesProfile !== null}
        onClose={() => {
          setBypassRulesProfile(null);
        }}
        profileId={bypassRulesProfile?.id ?? null}
        initialRules={bypassRulesProfile?.proxy_bypass_rules ?? []}
      />
      <ProfileDnsBlocklistDialog
        isOpen={dnsBlocklistProfile !== null}
        onClose={() => {
          setDnsBlocklistProfile(null);
        }}
        profileId={dnsBlocklistProfile?.id ?? null}
        currentLevel={dnsBlocklistProfile?.dns_blocklist ?? null}
      />
      <ProfileLaunchHookDialog
        isOpen={launchHookProfile !== null}
        onClose={() => {
          setLaunchHookProfile(null);
        }}
        profileId={launchHookProfile?.id ?? null}
        currentLaunchHook={launchHookProfile?.launch_hook ?? null}
      />
    </>
  );
}
