import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const exchangeDeviceCode = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/use-cloud-auth", () => ({
  useCloudAuth: () => ({ exchangeDeviceCode }),
}));

vi.mock("@/lib/toast-utils", () => ({
  showSuccessToast: vi.fn(),
  showErrorToast: vi.fn(),
}));

vi.mock("@/components/app-shell/window-drag-area", () => ({
  WindowDragArea: () => null,
}));

import { DeviceCodeVerifyDialog } from "./device-code-verify-dialog";

describe("DeviceCodeVerifyDialog (SY-06 smoke)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    exchangeDeviceCode.mockResolvedValue(undefined);
    invokeMock.mockResolvedValue(undefined);
  });

  it("verifies device code and restarts sync", async () => {
    const onClose = vi.fn();
    render(<DeviceCodeVerifyDialog isOpen={true} onClose={onClose} />);

    expect(screen.getByText("sync.cloud.signInTitle")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("sync.cloud.linkCodeLabel"), {
      target: { value: " ABCD-1234 " },
    });
    fireEvent.click(screen.getByText("sync.cloud.verifyAndLogin"));

    await waitFor(() => {
      expect(exchangeDeviceCode).toHaveBeenCalledWith("ABCD-1234");
    });
    expect(invokeMock).toHaveBeenCalledWith("restart_sync_service");
    expect(onClose).toHaveBeenCalledWith(true);
  });
});
