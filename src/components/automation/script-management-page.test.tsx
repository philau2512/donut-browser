import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { showSuccessToast } from "@/lib/toast-utils";
import { ScriptManagementPage } from "./script-management-page";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, _opts?: unknown) => key }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

vi.mock("@/lib/toast-utils", () => ({
  showSuccessToast: vi.fn(),
  showErrorToast: vi.fn(),
}));

const mockWriteFlow = vi.fn();
const mockReadFlow = vi.fn();
const mockReload = vi.fn();
const mockDeleteFlow = vi.fn();

vi.mock("@/hooks/use-script-management", () => ({
  useScriptManagement: () => ({
    flows: [
      { path: "C:/flows/demo.donutflow", name: "demo", modified_ms: null },
    ],
    isLoading: false,
    reload: mockReload,
    readFlow: mockReadFlow,
    writeFlow: mockWriteFlow,
    deleteFlow: mockDeleteFlow,
  }),
}));

const openMock = vi.mocked(open);
const saveMock = vi.mocked(save);
const readTextFileMock = vi.mocked(readTextFile);
const writeTextFileMock = vi.mocked(writeTextFile);

const plainJson = JSON.stringify({
  version: 1,
  name: "demo",
  variables: {},
  nodes: [],
  edges: [],
});
const varsJson = JSON.stringify({
  version: 1,
  name: "demo",
  variables: { EMAIL: "x" },
  nodes: [],
  edges: [],
});

function renderPage() {
  render(
    <ScriptManagementPage
      onRun={vi.fn()}
      onEdit={vi.fn()}
      onCreate={vi.fn()}
    />,
  );
}

describe("ScriptManagementPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReload.mockResolvedValue(undefined);
    mockReadFlow.mockResolvedValue(plainJson);
    mockWriteFlow.mockResolvedValue("C:/flows/demo (2).donutflow");
    // Layout sidecar exists; reviewed sidecar does not — both non-fatal
    readTextFileMock.mockImplementation((path: string | URL) => {
      if (String(path).endsWith(".layout.json"))
        return Promise.resolve('{"version":1,"positions":{}}');
      return Promise.reject(new Error("not found"));
    });
    writeTextFileMock.mockResolvedValue(undefined);
  });

  it("duplicates flow and copies layout+reviewed sidecars", async () => {
    renderPage();

    fireEvent.click(
      screen.getByRole("button", { name: /automation\.script\.duplicate/i }),
    );

    await waitFor(() =>
      expect(mockWriteFlow).toHaveBeenCalledWith("demo (2)", plainJson, false),
    );
    expect(writeTextFileMock).toHaveBeenCalledWith(
      "C:/flows/demo (2).layout.json",
      expect.any(String),
    );
    expect(showSuccessToast).toHaveBeenCalled();
    expect(mockReload).toHaveBeenCalled();
  });

  it("exports flow without warning when no variables", async () => {
    saveMock.mockResolvedValue("C:/export/demo.donutflow");
    window.confirm = vi.fn(() => true);
    renderPage();

    fireEvent.click(
      screen.getByRole("button", { name: /automation\.script\.export/i }),
    );

    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(window.confirm).not.toHaveBeenCalled();
    expect(writeTextFileMock).toHaveBeenCalledWith(
      "C:/export/demo.donutflow",
      plainJson,
    );
    expect(showSuccessToast).toHaveBeenCalled();
  });

  it("shows variable warning on export and aborts when user cancels", async () => {
    mockReadFlow.mockResolvedValue(varsJson);
    window.confirm = vi.fn(() => false);
    renderPage();

    fireEvent.click(
      screen.getByRole("button", { name: /automation\.script\.export/i }),
    );

    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("imports flow with collision — shows confirm overwrite, aborts on cancel", async () => {
    openMock.mockResolvedValue("C:/import/demo.donutflow");
    readTextFileMock.mockResolvedValueOnce(plainJson);
    mockWriteFlow.mockRejectedValueOnce("exists");
    window.confirm = vi.fn(() => false);

    renderPage();
    fireEvent.click(
      screen.getByRole("button", { name: /automation\.script\.import/i }),
    );

    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(mockWriteFlow).toHaveBeenCalledTimes(1);
    expect(showSuccessToast).not.toHaveBeenCalled();
  });

  it("imports flow with collision — overwrites when user confirms", async () => {
    openMock.mockResolvedValue("C:/import/demo.donutflow");
    readTextFileMock.mockResolvedValueOnce(plainJson);
    mockWriteFlow
      .mockRejectedValueOnce("exists")
      .mockResolvedValueOnce("C:/flows/demo.donutflow");
    window.confirm = vi.fn(() => true);

    renderPage();
    fireEvent.click(
      screen.getByRole("button", { name: /automation\.script\.import/i }),
    );

    await waitFor(() => expect(mockWriteFlow).toHaveBeenCalledTimes(2));
    expect(mockWriteFlow).toHaveBeenLastCalledWith("demo", plainJson, true);
    expect(showSuccessToast).toHaveBeenCalled();
    expect(mockReload).toHaveBeenCalled();
  });
});
