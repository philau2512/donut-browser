"use client";

import React, { useCallback, useState } from "react";
import { LuPencil } from "react-icons/lu";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { BrowserProfile } from "@/types";

interface TagsCellProps {
  profile: BrowserProfile;
  isDisabled: boolean;
  tagsOverrides: Record<string, string[]>;
  onAssignTags?: (profileIds: string[]) => void;
  // Kept for backward compatibility but unused
  allTags?: string[];
  setAllTags?: React.Dispatch<React.SetStateAction<string[]>>;
  openTagsEditorFor?: string | null;
  setOpenTagsEditorFor?: React.Dispatch<React.SetStateAction<string | null>>;
  setTagsOverrides?: React.Dispatch<
    React.SetStateAction<Record<string, string[]>>
  >;
}

export const TagsCell = React.memo<TagsCellProps>(
  ({ profile, isDisabled, tagsOverrides, onAssignTags }) => {
    const [isHovered, setIsHovered] = useState(false);

    const effectiveTags: string[] = Object.hasOwn(tagsOverrides, profile.id)
      ? tagsOverrides[profile.id]
      : (profile.tags ?? []);

    const handleClick = useCallback(() => {
      if (!isDisabled && onAssignTags) {
        onAssignTags([profile.id]);
      }
    }, [isDisabled, onAssignTags, profile.id]);

    const handleMouseEnter = () => {
      if (!isDisabled) setIsHovered(true);
    };

    const handleMouseLeave = () => {
      setIsHovered(false);
    };

    const ButtonContent = (
      <button
        type="button"
        className={cn(
          "flex h-6 w-full items-center gap-1 overflow-hidden rounded border-none bg-transparent px-2 py-1 text-left outline-none",
          isDisabled
            ? "cursor-not-allowed opacity-60"
            : "cursor-pointer hover:bg-accent/50",
          effectiveTags.length === 0 && "justify-center",
        )}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {effectiveTags.length > 0 ? (
          effectiveTags.map((t) => (
            <Badge
              key={t}
              variant="secondary"
              className="px-2 py-0 text-xs truncate max-w-[120px]"
            >
              {t}
            </Badge>
          ))
        ) : isHovered ? (
          <LuPencil className="size-3.5 text-muted-foreground hover:text-foreground" />
        ) : (
          <span className="text-muted-foreground text-sm">---</span>
        )}
      </button>
    );

    return (
      <div className="h-6 w-full">
        <Tooltip>
          <TooltipTrigger asChild>{ButtonContent}</TooltipTrigger>
          {effectiveTags.length > 0 && (
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
  },
);

TagsCell.displayName = "TagsCell";
