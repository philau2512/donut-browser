import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

vi.mock("@/components/app-shell/window-drag-area", () => ({
  WindowDragArea: () => null,
}));

vi.mock("@/components/home", () => ({
  DataTableActionBar: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DataTableActionBarAction: ({ children }: { children?: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  DataTableActionBarSelection: () => null,
}));

vi.mock("@/components/ui/pro-badge", () => ({
  ProBadge: () => null,
}));

vi.mock("@/hooks/use-extension-management", () => ({
  useExtensionManagement: () => ({
    extensions: [{ id: "e1", name: "uBlock" }],
    extensionGroups: [{ id: "g1", name: "Default" }],
    isLoading: false,
    isUploading: false,
    extensionName: "",
    setExtensionName: vi.fn(),
    showUploadForm: false,
    setShowUploadForm: vi.fn(),
    pendingFile: null,
    setPendingFile: vi.fn(),
    showCreateGroup: false,
    setShowCreateGroup: vi.fn(),
    newGroupName: "",
    setNewGroupName: vi.fn(),
    editingGroup: null,
    setEditingGroup: vi.fn(),
    editGroupName: "",
    setEditGroupName: vi.fn(),
    editGroupExtensionIds: [],
    setEditGroupExtensionIds: vi.fn(),
    extensionToDelete: null,
    setExtensionToDelete: vi.fn(),
    groupToDelete: null,
    setGroupToDelete: vi.fn(),
    isDeleting: false,
    bulkExtDeleteOpen: false,
    setBulkExtDeleteOpen: vi.fn(),
    bulkGroupDeleteOpen: false,
    setBulkGroupDeleteOpen: vi.fn(),
    editingExtension: null,
    setEditingExtension: vi.fn(),
    editExtensionName: "",
    setEditExtensionName: vi.fn(),
    pendingUpdateFile: null,
    setPendingUpdateFile: vi.fn(),
    extTable: {
      getSelectedRowModel: () => ({ rows: [] }),
      getIsSomeRowsSelected: () => false,
      getIsAllPageRowsSelected: () => false,
    },
    groupTable: {
      getSelectedRowModel: () => ({ rows: [] }),
      getIsSomeRowsSelected: () => false,
      getIsAllPageRowsSelected: () => false,
    },
    activeTab: "extensions",
    setActiveTab: vi.fn(),
    selectedExtensions: [],
    selectedGroups: [],
    handleFileSelect: vi.fn(),
    handleUpload: vi.fn(),
    handleDeleteExtension: vi.fn(),
    handleUpdateExtension: vi.fn(),
    handleEditFileSelect: vi.fn(),
    handleCreateGroup: vi.fn(),
    handleSaveGroupEdits: vi.fn(),
    handleDeleteGroup: vi.fn(),
    handleBulkDeleteExtensions: vi.fn(),
    handleBulkDeleteGroups: vi.fn(),
    handleBulkToggleExtSync: vi.fn(),
    handleBulkToggleGroupSync: vi.fn(),
    renderExtensionIcon: () => null,
    renderCompatIcons: () => null,
  }),
}));

vi.mock("./sub-components/extension-list-tab", () => ({
  ExtensionListTab: () => <div data-testid="ext-list" />,
}));
vi.mock("./sub-components/extension-group-tab", () => ({
  ExtensionGroupTab: () => <div data-testid="group-list" />,
}));
vi.mock("./sub-components/edit-extension-dialog", () => ({
  EditExtensionDialog: () => null,
}));
vi.mock("./sub-components/edit-group-dialog", () => ({
  EditGroupDialog: () => null,
}));

import { ExtensionManagementDialog } from "./extension-management-dialog";

describe("ExtensionManagementDialog (EX-04 smoke)", () => {
  it("opens with extensions/groups tabs", () => {
    render(
      <ExtensionManagementDialog
        isOpen={true}
        onClose={vi.fn()}
        limitedMode={false}
      />,
    );

    expect(screen.getByText("extensions.title")).toBeTruthy();
    expect(screen.getByText("extensions.extensionsTab")).toBeTruthy();
    expect(screen.getByText("extensions.groupsTab")).toBeTruthy();
    expect(screen.getByLabelText("extensions.upload")).toBeTruthy();
  });
});
