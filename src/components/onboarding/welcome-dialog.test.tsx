import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/use-permissions", () => ({
  usePermissions: () => ({ requestPermission: vi.fn() }),
}));

vi.mock("@/hooks/use-browser-setup", () => ({
  useBrowserSetup: () => ({
    status: "idle",
    progress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    speedBps: 0,
    etaSeconds: 0,
  }),
}));

vi.mock("@/components/icons/logo", () => ({
  Logo: () => <div data-testid="logo" />,
}));

vi.mock("@/components/app-shell/window-drag-area", () => ({
  WindowDragArea: () => null,
}));

import { WelcomeDialog } from "./welcome-dialog";

describe("WelcomeDialog (SH-03 smoke)", () => {
  it("renders intro and completes when skip without setup", () => {
    const onComplete = vi.fn();
    render(
      <WelcomeDialog
        isOpen={true}
        needsSetup={false}
        onComplete={onComplete}
      />,
    );

    expect(screen.getAllByText("welcome.title").length).toBeGreaterThan(0);
    expect(screen.getByText("welcome.tagline")).toBeTruthy();
    fireEvent.click(screen.getByText("welcome.skip"));
    expect(onComplete).toHaveBeenCalled();
  });
});
