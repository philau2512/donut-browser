"use client";

import { FaBookmark } from "react-icons/fa";

export function BookmarkTab() {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-base font-bold">Default Bookmarks</h3>
        <p className="text-xs text-muted-foreground">
          Configure initial bookmarks that will be available inside the profile.
        </p>
      </div>
      <div className="flex flex-col items-center justify-center border border-dashed rounded-lg p-12 text-center bg-muted/5">
        <FaBookmark className="size-10 text-muted-foreground/30 mb-4 animate-pulse" />
        <h4 className="text-sm font-semibold text-foreground">
          Bookmarks Import & Sync
        </h4>
        <p className="text-xs text-muted-foreground max-w-sm mt-1 mb-3">
          This feature is currently under active development. In the next
          release, you will be able to bulk import bookmarks via HTML file
          upload.
        </p>
      </div>
    </div>
  );
}
