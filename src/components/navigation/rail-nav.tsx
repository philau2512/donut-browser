"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FaDownload } from "react-icons/fa";

import { GoGear } from "react-icons/go";
import {
  LuChevronLeft,
  LuChevronRight,
  LuCloud,
  LuFolder,
  LuGlobe,
  LuKeyboard,
  LuPlug,
  LuPlus,
  LuPuzzle,
  LuShield,
  LuUser,
  LuWorkflow,
} from "react-icons/lu";
import { cn } from "@/lib/utils";
import { Logo } from "../icons/logo";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

export type AppPage =
  | "profiles"
  | "automation"
  | "proxies"
  | "extensions"
  | "groups"
  | "vpns"
  | "settings"
  | "integrations"
  | "account"
  | "import"
  | "shortcuts";

const CLICK_THRESHOLD = 5;
const CLICK_WINDOW_MS = 2000;
const GRAVITY = 2200;
const BOUNCE_DAMPING = 0.6;
const INITIAL_HORIZONTAL_SPEED = 350;
const SPIN_SPEED = 720;
const MIN_BOUNCE_VELOCITY = 60;
const LOGO_HIDDEN_KEY = "donut-logo-hidden";

function useLogoEasterEgg({
  currentPage,
  onNavigate,
}: {
  currentPage: AppPage;
  onNavigate: (page: AppPage) => void;
}) {
  const clickTimestamps = useRef<number[]>([]);
  const [isPressed, setIsPressed] = useState(false);
  const [wobbleKey, setWobbleKey] = useState(0);
  const [isFalling, setIsFalling] = useState(false);
  /**
   * Click count toward the bounce trigger while the user is on the profiles
   * page. Capped at 4: each click here grows the logo by 25%, so step 4 has
   * doubled the original size. Click 5 fires `triggerFall` and resets.
   */
  const [growStep, setGrowStep] = useState(0);
  const resetTimeoutRef = useRef<number | null>(null);
  const [isHidden, setIsHidden] = useState(() => {
    try {
      return sessionStorage.getItem(LOGO_HIDDEN_KEY) === "1";
    } catch {
      return false;
    }
  });
  const logoRef = useRef<HTMLButtonElement>(null);
  const animFrameRef = useRef<number>(0);

  const triggerFall = useCallback(() => {
    const el = logoRef.current;
    if (!el || isFalling) return;
    setIsFalling(true);

    const rect = el.getBoundingClientRect();
    const startX = rect.left;
    const startY = rect.top;

    const clone = el.cloneNode(true) as HTMLElement;
    clone.style.position = "fixed";
    clone.style.left = `${startX}px`;
    clone.style.top = `${startY}px`;
    clone.style.zIndex = "9999";
    clone.style.pointerEvents = "none";
    clone.style.margin = "0";
    document.body.appendChild(clone);
    el.style.visibility = "hidden";

    let x = 0;
    let y = 0;
    let vy = -500;
    // Roll right first, bounce off the right wall, then escape the left.
    let vx = INITIAL_HORIZONTAL_SPEED;
    let rotation = 0;
    let lastTime = performance.now();

    const animate = (time: number) => {
      const dt = Math.min((time - lastTime) / 1000, 0.05);
      lastTime = time;

      // Read live so a mid-animation window resize moves the floor/wall.
      const floorY = window.innerHeight;
      const rightWall = window.innerWidth;

      vy += GRAVITY * dt;
      x += vx * dt;
      y += vy * dt;
      rotation += SPIN_SPEED * dt * (vx > 0 ? 1 : -1);

      const currentBottom = startY + y + rect.height;
      if (currentBottom >= floorY && vy > 0) {
        y = floorY - startY - rect.height;
        vy =
          Math.abs(vy) > MIN_BOUNCE_VELOCITY
            ? -Math.abs(vy) * BOUNCE_DAMPING
            : -MIN_BOUNCE_VELOCITY * 3;
      }

      // Right-wall bounce: hit, reverse horizontal velocity (with a tiny
      // damping), and keep rolling. Left wall has no bounce — the donut
      // exits the window off the left edge.
      const currentRight = startX + x + rect.width;
      if (currentRight >= rightWall && vx > 0) {
        x = rightWall - startX - rect.width;
        vx = -Math.abs(vx) * 0.9;
      }

      clone.style.transform = `translate(${x}px, ${y}px) rotate(${rotation}deg)`;

      const offScreenLeft = startX + x + rect.width < -200;
      const offScreenBottom = startY + y > floorY + 100;
      const offScreenTop = startY + y + rect.height < -200;

      if (offScreenLeft || offScreenBottom || offScreenTop) {
        clone.remove();
        try {
          sessionStorage.setItem(LOGO_HIDDEN_KEY, "1");
        } catch {
          // ignore — sessionStorage unavailable in some Tauri WebViews
        }
        setIsHidden(true);
        setIsFalling(false);
        return;
      }
      animFrameRef.current = requestAnimationFrame(animate);
    };
    animFrameRef.current = requestAnimationFrame(animate);
  }, [isFalling]);

  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  const handleClick = useCallback(() => {
    if (isFalling || isHidden) return;

    // First behaviour: any click from elsewhere in the app just routes the
    // user back to the profiles list. Growing the donut requires the user
    // to already be home — that keeps the easter egg from accidentally
    // firing during normal navigation.
    if (currentPage !== "profiles") {
      onNavigate("profiles");
      clickTimestamps.current = [];
      setGrowStep(0);
      if (resetTimeoutRef.current !== null) {
        window.clearTimeout(resetTimeoutRef.current);
        resetTimeoutRef.current = null;
      }
      return;
    }

    const now = Date.now();
    clickTimestamps.current = clickTimestamps.current.filter(
      (t) => now - t < CLICK_WINDOW_MS,
    );
    clickTimestamps.current.push(now);

    if (clickTimestamps.current.length >= CLICK_THRESHOLD) {
      clickTimestamps.current = [];
      setGrowStep(0);
      if (resetTimeoutRef.current !== null) {
        window.clearTimeout(resetTimeoutRef.current);
        resetTimeoutRef.current = null;
      }
      triggerFall();
    } else {
      setGrowStep(
        Math.min(clickTimestamps.current.length, CLICK_THRESHOLD - 1),
      );
      setWobbleKey((k) => k + 1);
      if (resetTimeoutRef.current !== null) {
        window.clearTimeout(resetTimeoutRef.current);
      }
      resetTimeoutRef.current = window.setTimeout(() => {
        clickTimestamps.current = [];
        setGrowStep(0);
        resetTimeoutRef.current = null;
      }, CLICK_WINDOW_MS);
    }
  }, [currentPage, isFalling, isHidden, onNavigate, triggerFall]);

  // Leaving the profiles page mid-streak cancels growth so we never end up
  // with an outsized logo when the user returns later.
  useEffect(() => {
    if (currentPage !== "profiles") {
      clickTimestamps.current = [];
      setGrowStep(0);
      if (resetTimeoutRef.current !== null) {
        window.clearTimeout(resetTimeoutRef.current);
        resetTimeoutRef.current = null;
      }
    }
  }, [currentPage]);

  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current !== null) {
        window.clearTimeout(resetTimeoutRef.current);
      }
    };
  }, []);

  return {
    logoRef,
    isPressed,
    setIsPressed,
    wobbleKey,
    isFalling,
    isHidden,
    growStep,
    handleClick,
  };
}

interface RailNavProps {
  currentPage: AppPage;
  onNavigate: (page: AppPage) => void;
  onCreateProfileClick?: () => void;
  totalProfiles?: number;
  runningProfilesCount?: number;
}

export function RailNav({
  currentPage,
  onNavigate,
  onCreateProfileClick,
  totalProfiles = 0,
  runningProfilesCount = 0,
}: RailNavProps) {
  const { t } = useTranslation();
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      return localStorage.getItem("donut-sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });

  const toggleCollapse = () => {
    const nextValue = !isCollapsed;
    setIsCollapsed(nextValue);
    try {
      localStorage.setItem("donut-sidebar-collapsed", String(nextValue));
    } catch (_e) {
      // ignore
    }
  };

  const {
    logoRef,
    isPressed,
    setIsPressed,
    wobbleKey,
    isFalling,
    isHidden,
    growStep,
    handleClick,
  } = useLogoEasterEgg({ currentPage, onNavigate });

  const MENU_GROUPS = [
    {
      title: t("rail.groupProfiles", "PROFILES"),
      items: [
        {
          page: "profiles",
          Icon: LuUser,
          label: t("rail.profiles", "Profiles"),
        },
        { page: "groups", Icon: LuFolder, label: t("rail.groups", "Groups") },
        {
          page: "extensions",
          Icon: LuPuzzle,
          label: t("rail.extensions", "Extensions"),
        },
        {
          page: "automation",
          Icon: LuWorkflow,
          label: t("rail.automation", "Automation"),
        },
      ],
    },
    {
      title: t("rail.groupNetwork", "NETWORK"),
      items: [
        {
          page: "proxies",
          Icon: LuGlobe,
          label: t("rail.network", "Proxies"),
          badge: "IPs New",
        },
        { page: "vpns", Icon: LuShield, label: t("rail.vpns", "VPNs") },
      ],
    },
    {
      title: t("rail.groupSystem", "SYSTEM & CLOUD"),
      items: [
        {
          page: "integrations",
          Icon: LuPlug,
          label: t("rail.integrations", "Integrations"),
        },
        {
          page: "shortcuts",
          Icon: LuKeyboard,
          label: t("rail.shortcuts", "Shortcuts"),
        },
        {
          page: "import",
          Icon: FaDownload,
          label: t("rail.import", "Import Profiles"),
        },
        {
          page: "account",
          Icon: LuCloud,
          label: t("rail.account", "Cloud Account"),
        },
        {
          page: "settings",
          Icon: GoGear,
          label: t("rail.settings", "Settings"),
        },
      ],
    },
  ];

  return (
    <nav
      className={cn(
        "relative flex shrink-0 flex-col border-r border-border bg-card py-4 text-card-foreground select-none h-full transition-all duration-300 ease-in-out overflow-visible",
        isCollapsed ? "w-16 items-center" : "w-60",
      )}
    >
      {/* Toggle collapse button */}
      <button
        type="button"
        onClick={toggleCollapse}
        className="absolute top-[45%] -right-3 z-50 flex size-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-md transition-all hover:scale-110 hover:text-foreground cursor-pointer"
        aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {isCollapsed ? (
          <LuChevronRight className="size-3.5" />
        ) : (
          <LuChevronLeft className="size-3.5" />
        )}
      </button>

      {/* Brand logo & easter egg */}
      <div
        className={cn(
          "px-4 mb-4 flex items-center shrink-0 w-full justify-between",
          isCollapsed && "px-0 justify-center",
        )}
      >
        {!isHidden ? (
          <button
            ref={logoRef}
            type="button"
            aria-label={t("header.donutLogo")}
            className="flex items-center gap-2.5 cursor-pointer bg-transparent text-foreground select-none text-left"
            onClick={handleClick}
            onPointerDown={() => setIsPressed(true)}
            onPointerUp={() => setIsPressed(false)}
            onPointerLeave={() => setIsPressed(false)}
          >
            <span
              style={{
                transform: isPressed
                  ? `scale(${(1 + growStep * 0.25) * 0.9})`
                  : `scale(${1 + growStep * 0.25})`,
              }}
              className="inline-grid place-items-center transition-transform duration-300 ease-out will-change-transform shrink-0"
            >
              <span
                key={wobbleKey}
                className={cn(
                  "inline-grid place-items-center",
                  !isFalling &&
                    !isPressed &&
                    wobbleKey > 0 &&
                    "animate-[wiggle_0.3s_ease-in-out]",
                )}
              >
                <Logo className="size-6 text-primary" />
              </span>
            </span>
            {!isCollapsed && (
              <div className="flex flex-col min-w-0 animate-in fade-in duration-300">
                <span className="font-bold text-sm leading-tight tracking-tight text-foreground truncate">
                  Donut Browser
                </span>
                <span className="text-[9px] text-muted-foreground font-medium leading-none uppercase tracking-wider">
                  Local-First Engine
                </span>
              </div>
            )}
          </button>
        ) : (
          <div className="h-8" />
        )}
      </div>

      {/* Add Profile button */}
      <div
        className={cn(
          "px-4 mb-5 shrink-0 w-full",
          isCollapsed && "px-2 flex justify-center",
        )}
      >
        {isCollapsed ? (
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onCreateProfileClick}
                className="grid size-10 place-items-center rounded-lg bg-amber-400 hover:bg-amber-500 text-slate-955 font-bold shadow-md transition-all active:scale-95 duration-100 cursor-pointer"
              >
                <LuPlus className="size-5 stroke-[3]" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {t("header.newProfile", "Add Profile")}
            </TooltipContent>
          </Tooltip>
        ) : (
          <button
            type="button"
            onClick={onCreateProfileClick}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-400 hover:bg-amber-500 text-slate-955 font-bold py-2 px-4 shadow-md transition-all active:scale-95 duration-100 cursor-pointer text-sm"
          >
            <LuPlus className="size-4 stroke-[3]" />
            <span>{t("header.newProfile", "Add Profile")}</span>
          </button>
        )}
      </div>

      {/* Scrollable menu group */}
      <div
        className={cn(
          "flex-1 px-3 space-y-4 overflow-y-auto scrollbar-none w-full",
          isCollapsed && "px-1 space-y-3",
        )}
      >
        {MENU_GROUPS.map((group) => (
          <div key={group.title} className="space-y-1">
            {!isCollapsed ? (
              <span className="px-3 text-[10px] font-bold text-muted-foreground/60 tracking-wider uppercase block animate-in fade-in duration-300">
                {group.title}
              </span>
            ) : (
              <div className="h-px bg-border/40 mx-2 my-1 shrink-0" />
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = currentPage === item.page;
                const buttonContent = (
                  <button
                    key={item.page}
                    type="button"
                    onClick={() => onNavigate(item.page as AppPage)}
                    className={cn(
                      "flex w-full items-center rounded-lg text-sm transition-all duration-105 cursor-pointer",
                      isCollapsed
                        ? "justify-center size-10"
                        : "gap-3 px-3 py-1.5",
                      active
                        ? "bg-primary/15 text-primary font-semibold"
                        : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                    )}
                  >
                    <item.Icon
                      className={cn(
                        isCollapsed ? "size-5" : "size-4 shrink-0",
                        active ? "text-primary" : "text-muted-foreground",
                      )}
                    />
                    {!isCollapsed && (
                      <span className="truncate flex-1 text-left animate-in fade-in duration-300">
                        {item.label}
                      </span>
                    )}
                    {!isCollapsed && item.badge && (
                      <span className="rounded bg-blue-600/10 px-1.5 py-0.5 text-[9px] font-bold text-blue-400 animate-pulse border border-blue-500/20 shrink-0">
                        {item.badge}
                      </span>
                    )}
                  </button>
                );

                if (isCollapsed) {
                  return (
                    <Tooltip key={item.page} delayDuration={300}>
                      <TooltipTrigger asChild>{buttonContent}</TooltipTrigger>
                      <TooltipContent side="right">
                        <div className="flex items-center gap-1.5">
                          <span>{item.label}</span>
                          {item.badge && (
                            <span className="rounded bg-blue-600/20 px-1 py-0.5 text-[8px] font-bold text-blue-400">
                              {item.badge}
                            </span>
                          )}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  );
                }

                return buttonContent;
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Star on GitHub banner */}
      <div
        className={cn(
          "px-4 my-3 shrink-0 w-full",
          isCollapsed && "px-2 flex justify-center",
        )}
      >
        {isCollapsed ? (
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <a
                href="https://github.com/philau2512/donut-browser"
                target="_blank"
                rel="noreferrer"
                className="grid size-10 place-items-center rounded-lg bg-rose-500/10 border border-rose-500/20 hover:bg-rose-500/20 text-rose-400 transition-all active:scale-95 duration-100 cursor-pointer"
              >
                <svg
                  className="size-5 fill-current"
                  viewBox="0 0 16 16"
                  role="img"
                  aria-label="Star on GitHub"
                >
                  <title>Star on GitHub</title>
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                </svg>
              </a>
            </TooltipTrigger>
            <TooltipContent side="right">Star on GitHub</TooltipContent>
          </Tooltip>
        ) : (
          <a
            href="https://github.com/philau2512/donut-browser"
            target="_blank"
            rel="noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-rose-500/10 border border-rose-500/20 hover:bg-rose-500/20 text-rose-400 font-semibold py-2 px-4 shadow-sm transition-all active:scale-95 duration-100 cursor-pointer text-xs"
          >
            <svg
              className="size-4 shrink-0 fill-current"
              viewBox="0 0 16 16"
              role="img"
              aria-label="Star on GitHub"
            >
              <title>Star on GitHub</title>
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            <span>Star on GitHub</span>
          </a>
        )}
      </div>

      {/* System Local Stats Panel */}
      <div
        className={cn(
          "w-full shrink-0",
          isCollapsed ? "px-2 flex justify-center" : "px-4",
        )}
      >
        {!isCollapsed ? (
          <div className="p-3 rounded-xl bg-secondary/50 border border-border text-[11px] space-y-1.5 font-sans animate-in fade-in duration-300 w-full">
            <div className="text-center font-bold tracking-wider text-muted-foreground border-b border-border pb-1.5 mb-1.5 uppercase text-[10px]">
              {t("rail.statsHeader", "Local-First Engine")}
            </div>
            <div className="flex justify-between items-center text-muted-foreground">
              <span>Profiles cloud</span>
              <span className="font-semibold text-foreground flex items-center gap-1">
                <LuCloud className="size-3" />
                0/0
              </span>
            </div>
            <div className="flex justify-between items-center text-muted-foreground">
              <span>Profiles local</span>
              <span className="font-semibold text-foreground flex items-center gap-1">
                <LuUser className="size-3" />
                {totalProfiles}/∞
              </span>
            </div>
            <div className="flex justify-between items-center text-muted-foreground">
              <span>Active sessions</span>
              <span className="font-semibold text-foreground flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-success animate-ping shrink-0" />
                {runningProfilesCount}/∞
              </span>
            </div>
            <div className="flex justify-between items-center text-muted-foreground">
              <span>License status</span>
              <span className="font-bold text-success">LIFETIME</span>
            </div>
            <div className="flex justify-between items-center text-muted-foreground">
              <span>Expires on</span>
              <span className="font-semibold text-foreground">Never</span>
            </div>
          </div>
        ) : (
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <div className="grid size-10 place-items-center rounded-lg bg-secondary/50 border border-border/40 text-muted-foreground cursor-help my-2">
                <LuCloud className="size-5" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="right" className="space-y-1 text-xs">
              <div className="font-bold border-b border-border pb-1 mb-1 text-foreground">
                Local-First Engine
              </div>
              <div>Profiles cloud: 0/0</div>
              <div>Profiles local: {totalProfiles}/∞</div>
              <div>Active sessions: {runningProfilesCount}/∞</div>
              <div className="text-success font-bold">LIFETIME License</div>
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Support / Preferences link */}
      <div
        className={cn(
          "px-4 pb-2 shrink-0 w-full mt-2",
          isCollapsed && "px-2 flex justify-center",
        )}
      >
        {isCollapsed ? (
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onNavigate("settings")}
                className="grid size-10 place-items-center rounded-lg bg-primary hover:bg-primary/95 text-primary-foreground font-semibold shadow-sm transition-all active:scale-95 duration-100 cursor-pointer"
              >
                <GoGear className="size-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {t("rail.preferences", "Preferences")}
            </TooltipContent>
          </Tooltip>
        ) : (
          <button
            type="button"
            onClick={() => onNavigate("settings")}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary hover:bg-primary/95 text-primary-foreground font-semibold py-1.5 px-4 shadow-sm transition-all active:scale-95 duration-100 cursor-pointer text-xs"
          >
            <span>{t("rail.preferences", "Preferences")}</span>
          </button>
        )}
      </div>
    </nav>
  );
}
