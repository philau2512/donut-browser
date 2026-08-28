import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const buildFinalWayfernConfig = vi.fn();
const handleGenerateFingerprint = vi.fn();
const loadReleaseTypes = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: vi.fn().mockResolvedValue(false),
    onResized: vi.fn().mockResolvedValue(() => {}),
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
  }),
}));

vi.mock("@/components/app-shell/window-drag-area", () => ({
  WindowDragArea: () => null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/hooks/use-proxy-events", () => ({
  useProxyEvents: () => ({ storedProxies: [] }),
}));

vi.mock("@/hooks/use-vpn-events", () => ({
  useVpnEvents: () => ({ vpnConfigs: [] }),
}));

vi.mock("@/hooks/use-browser-version", () => ({
  useBrowserVersion: () => ({
    isLoadingReleaseTypes: false,
    getCreatableVersion: () => ({
      version: "1.0.0",
      releaseType: "stable" as const,
    }),
    getDownloadedVersions: () => ["1.0.0"],
    isBrowserCurrentlyDownloading: () => false,
    loadReleaseTypes,
    downloadBrowser: vi.fn(),
    getBestAvailableVersion: () => ({ version: "1.0.0" }),
  }),
}));

vi.mock("@/hooks/use-wayfern-config", () => ({
  useWayfernConfig: () => ({
    wayfernConfig: { os: "windows", geoip: true },
    fingerprintConfig: {},
    isGeneratingFingerprint: false,
    updateWayfernConfig: vi.fn(),
    updateFingerprintConfig: vi.fn(),
    updateFingerprintConfigs: vi.fn(),
    handleGenerateFingerprint,
    handleAutoLocationToggle: vi.fn(),
    handleFixedLanguageToggle: vi.fn(),
    handleFixedLanguageChange: vi.fn(),
    fixedLanguageEnabled: false,
    fixedLanguage: "en-US",
    isAutoLocationEnabled: true,
    isFingerprintEditingDisabled: false,
    resetWayfernState: vi.fn(),
    buildFinalWayfernConfig,
  }),
}));

vi.mock("@/components/proxy", () => ({
  ProxyFormDialog: () => null,
}));

// Keep dialog surface small: only base-info + footer matter for this smoke.
vi.mock("./sub-components/location-tab", () => ({ LocationTab: () => null }));
vi.mock("./sub-components/proxy-tab", () => ({ ProxyTab: () => null }));
vi.mock("./sub-components/cookies-tab", () => ({ CookiesTab: () => null }));
vi.mock("./sub-components/hardware-tab", () => ({ HardwareTab: () => null }));
vi.mock("./sub-components/command-tab", () => ({ CommandTab: () => null }));
vi.mock("./sub-components/bookmark-tab", () => ({ BookmarkTab: () => null }));
vi.mock("./sub-components/extension-tab", () => ({ ExtensionTab: () => null }));
vi.mock("./sub-components/requests-tab", () => ({ RequestsTab: () => null }));
vi.mock("./sub-components/other-tab", () => ({ OtherTab: () => null }));
vi.mock("./sub-components/automation-tab", () => ({
  AutomationTab: () => null,
}));

import { CreateProfileDialog } from "./create-profile-dialog";

describe("CreateProfileDialog (PR-17 smoke)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_groups_with_profile_counts") return [];
      if (cmd === "list_extension_groups") return [];
      if (cmd === "is_geoip_database_available") return true;
      return null;
    });
    buildFinalWayfernConfig.mockResolvedValue({
      os: "windows",
      fingerprint: '{"ua":"smoke"}',
      geoip: true,
    });
  });

  it("opens and submits create with name + wayfern payload", async () => {
    const onCreateProfile = vi.fn().mockResolvedValue({ id: "prof-1" });
    const onClose = vi.fn();

    render(
      <CreateProfileDialog
        isOpen={true}
        onClose={onClose}
        onCreateProfile={onCreateProfile}
      />,
    );

    // Dialog title / name field present
    expect(screen.getByLabelText("createProfile.profileName")).toBeTruthy();

    const nameInput = screen.getByLabelText("createProfile.profileName");
    fireEvent.change(nameInput, { target: { value: "Smoke Create" } });

    const createButtons = screen.getAllByRole("button", {
      name: "common.buttons.create",
    });
    // Footer primary create (last match if BaseInfo also has one)
    fireEvent.click(createButtons[createButtons.length - 1]);

    await waitFor(() => {
      expect(onCreateProfile).toHaveBeenCalledTimes(1);
    });

    expect(onCreateProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Smoke Create",
        browserStr: "wayfern",
        version: "1.0.0",
        releaseType: "stable",
        wayfernConfig: expect.objectContaining({
          fingerprint: '{"ua":"smoke"}',
        }),
      }),
    );
  });

  it("keeps create disabled when name is empty", () => {
    render(
      <CreateProfileDialog
        isOpen={true}
        onClose={vi.fn()}
        onCreateProfile={vi.fn()}
      />,
    );

    const createButtons = screen.getAllByRole("button", {
      name: "common.buttons.create",
    });
    const footerCreate = createButtons[createButtons.length - 1];
    expect(footerCreate).toBeDisabled();
  });
});
