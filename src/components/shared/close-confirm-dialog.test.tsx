import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
let closeListener: (() => void) | null = null;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, cb: () => void) => {
    if (event === "close-confirm-requested") {
      closeListener = cb;
    }
    return () => {
      closeListener = null;
    };
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { on: vi.fn(), off: vi.fn() },
  }),
}));

vi.mock("@/components/app-shell/window-drag-area", () => ({
  WindowDragArea: () => null,
}));

import { CloseConfirmDialog } from "./close-confirm-dialog";

describe("CloseConfirmDialog (SH-04/05 smoke)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    closeListener = null;
    invokeMock.mockResolvedValue(undefined);
  });

  it("syncs tray labels and handles quit", async () => {
    render(<CloseConfirmDialog />);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "update_tray_menu",
        expect.objectContaining({
          showLabel: "tray.show",
          quitLabel: "tray.quit",
        }),
      );
    });

    expect(closeListener).toBeTypeOf("function");
    closeListener?.();

    expect(await screen.findByText("closeConfirm.title")).toBeTruthy();
    fireEvent.click(screen.getByText("closeConfirm.quit"));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("confirm_quit");
    });
  });
});
