import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/app-shell/window-drag-area", () => ({
  WindowDragArea: () => null,
}));

import { WindowResizeWarningDialog } from "./window-resize-warning-dialog";

describe("WindowResizeWarningDialog (SH-05 smoke)", () => {
  it("continues and optionally dismisses warning", async () => {
    const onResult = vi.fn();

    render(<WindowResizeWarningDialog isOpen={true} onResult={onResult} />);

    expect(screen.getByText("warnings.windowResizeTitle")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("warnings.dontShowAgain"));
    fireEvent.click(screen.getByRole("button", { name: "warnings.continue" }));

    await waitFor(() => {
      expect(onResult).toHaveBeenCalledWith(true);
    });
    expect(invokeMock).toHaveBeenCalledWith("dismiss_window_resize_warning");
  });
});
