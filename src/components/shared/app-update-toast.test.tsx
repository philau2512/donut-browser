import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AppUpdateInfo } from "@/types";
import { AppUpdateToast } from "./app-update-toast";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const updateInfo: AppUpdateInfo = {
  current_version: "0.28.0",
  new_version: "0.28.2",
  release_notes: "fixes",
  download_url: "https://example.com/dl",
  is_nightly: false,
  published_at: "2026-01-01",
  manual_update_required: false,
  release_page_url: "https://example.com/rel",
  repo_update: false,
};

describe("AppUpdateToast (UP-03 smoke)", () => {
  it("renders version range and dismisses", () => {
    const onDismiss = vi.fn();
    const onRestart = vi.fn().mockResolvedValue(undefined);

    render(
      <AppUpdateToast
        updateInfo={updateInfo}
        onRestart={onRestart}
        onDismiss={onDismiss}
        updateReady={true}
      />,
    );

    expect(screen.getByText(/0\.28\.0/)).toBeTruthy();
    expect(screen.getByText(/0\.28\.2/)).toBeTruthy();
    expect(screen.getByText("appUpdate.toast.updateReady")).toBeTruthy();

    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[0]);
    expect(onDismiss).toHaveBeenCalled();
  });
});
