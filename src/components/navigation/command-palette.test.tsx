import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: vi.fn().mockResolvedValue(false),
    onResized: vi.fn().mockResolvedValue(() => {}),
  }),
}));

vi.mock("@/components/app-shell/window-drag-area", () => ({
  WindowDragArea: () => null,
}));

import { CommandPalette } from "./command-palette";

describe("CommandPalette (SH-01 smoke)", () => {
  beforeAll(() => {
    // cmdk calls scrollIntoView on selected items
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("opens and lists navigation actions", () => {
    render(
      <CommandPalette
        open={true}
        onOpenChange={vi.fn()}
        onAction={vi.fn()}
        groupTargets={[]}
        onSelectGroup={vi.fn()}
        profiles={[]}
        runningProfileIds={new Set()}
        onLaunchProfile={vi.fn()}
        onKillProfile={vi.fn()}
        onShowProfileInfo={vi.fn()}
        onCreateProfile={vi.fn()}
        onOpenAbout={vi.fn()}
      />,
    );

    expect(screen.getByText("shortcuts.goProfiles")).toBeTruthy();
    expect(screen.getByText("shortcuts.goSettings")).toBeTruthy();
    expect(
      screen.getByPlaceholderText("commandPalette.placeholder"),
    ).toBeTruthy();
  });
});
