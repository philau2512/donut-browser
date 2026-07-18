import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(),
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/hooks/use-proxy-events", () => ({
  useProxyEvents: () => ({
    storedProxies: [
      {
        id: "p1",
        name: "Proxy One",
        proxy_settings: {
          proxy_type: "http",
          host: "1.1.1.1",
          port: 8080,
        },
        sync_enabled: false,
      },
    ],
  }),
}));

vi.mock("@/hooks/use-vpn-events", () => ({
  useVpnEvents: () => ({
    vpnConfigs: [{ id: "v1", name: "VPN One", vpn_type: "WireGuard" }],
  }),
}));

vi.mock("@/lib/toast-utils", () => ({
  showSuccessToast: vi.fn(),
  showErrorToast: vi.fn(),
}));

vi.mock("@/components/app-shell/window-drag-area", () => ({
  WindowDragArea: () => null,
}));

vi.mock("./proxy-form-dialog", () => ({ ProxyFormDialog: () => null }));
vi.mock("./proxy-import-dialog", () => ({ ProxyImportDialog: () => null }));
vi.mock("./proxy-export-dialog", () => ({ ProxyExportDialog: () => null }));
vi.mock("../vpn", () => ({
  VpnFormDialog: () => null,
  VpnImportDialog: () => null,
}));
vi.mock("./sub-components/proxy-list-tab", () => ({
  ProxyListTab: () => <div data-testid="proxy-list-tab" />,
}));
vi.mock("./sub-components/vpn-list-tab", () => ({
  VpnListTab: () => <div data-testid="vpn-list-tab" />,
}));

import { ProxyManagementDialog } from "./proxy-management-dialog";

describe("ProxyManagementDialog (PX-08 / VN-05 UI smoke)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockResolvedValue(false);
  });

  it("opens with proxies/vpns tabs and new-proxy action", () => {
    render(<ProxyManagementDialog isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByText("proxies.management.title")).toBeTruthy();
    expect(screen.getByText("proxies.management.tabProxies")).toBeTruthy();
    expect(screen.getByText("proxies.management.tabVpns")).toBeTruthy();
    expect(screen.getByLabelText("proxies.management.newProxy")).toBeTruthy();
    expect(screen.getByTestId("proxy-list-tab")).toBeTruthy();
  });
});
