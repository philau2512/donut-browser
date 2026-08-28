import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/use-wayfern-terms", () => ({
  useWayfernTerms: () => ({ termsAccepted: true }),
}));

vi.mock("@/lib/toast-utils", () => ({
  showSuccessToast: vi.fn(),
  showErrorToast: vi.fn(),
}));

vi.mock("@/lib/backend-errors", () => ({
  translateBackendError: (_t: unknown, e: unknown) => String(e),
}));

vi.mock("@/components/app-shell/window-drag-area", () => ({
  WindowDragArea: () => null,
}));

import { IntegrationsDialog } from "./integrations-dialog";

describe("IntegrationsDialog (AP-05 smoke)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_app_settings") {
        return {
          api_enabled: false,
          api_port: 10108,
          mcp_enabled: false,
        };
      }
      if (cmd === "get_api_server_status") return null;
      if (cmd === "get_mcp_config") return null;
      if (cmd === "get_mcp_server_status") return false;
      if (cmd === "list_mcp_agents") return [];
      return null;
    });
  });

  it("opens API/MCP tabs and loads settings", async () => {
    render(<IntegrationsDialog isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByText("integrations.title")).toBeTruthy();
    expect(screen.getByText("integrations.tabApi")).toBeTruthy();
    expect(screen.getByText("integrations.tabMcp")).toBeTruthy();

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("get_app_settings");
    });
  });
});
