import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StepFourProperties } from "./step-four-properties";
import { useCreateResourceWizard } from "./wizard-context";

// Mock i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: any) =>
      params?.type ? `${key}_${params.type}` : key,
  }),
}));

// Mock useCreateResourceWizard
vi.mock("./wizard-context", () => ({
  useCreateResourceWizard: vi.fn(),
}));

describe("StepFourProperties", () => {
  const defaultMockContext: any = {
    wizardType: "FixedString",
    defaultValue: "",
    setDefaultValue: vi.fn(),
    notEmpty: false,
    setNotEmpty: vi.fn(),
    multiline: false,
    setMultiline: vi.fn(),
    minInteger: 0,
    setMinInteger: vi.fn(),
    maxInteger: 100,
    setMaxInteger: vi.fn(),
    filePath: "",
    setFilePath: vi.fn(),
    url: "",
    setUrl: vi.fn(),
    selectType: "Combo",
    setSelectType: vi.fn(),
    selectOptions: "",
    setSelectOptions: vi.fn(),
    selectDefaultValue: "",
    setSelectDefaultValue: vi.fn(),
    checkboxDefault: false,
    setCheckboxDefault: vi.fn(),
    dbConnection: "",
    setDbConnection: vi.fn(),
    infoMessage: "",
    setInfoMessage: vi.fn(),
    handleBrowseFile: vi.fn(),
    handleBrowseDirectory: vi.fn(),
  };

  it("renders String properties correctly for FixedString type", () => {
    vi.mocked(useCreateResourceWizard).mockReturnValue({
      ...defaultMockContext,
      wizardType: "FixedString",
      defaultValue: "test-string",
    });

    render(<StepFourProperties />);

    const defaultValInput = screen.getByLabelText(
      "automation.editor.resources.wizard.step4_default_value",
    );
    expect(defaultValInput).toBeInTheDocument();
    expect(defaultValInput).toHaveValue("test-string");

    expect(
      screen.getByText("automation.editor.resources.wizard.step4_not_empty"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("automation.editor.resources.wizard.step4_multiline"),
    ).toBeInTheDocument();
  });

  it("renders FixedInteger type properties correctly", () => {
    vi.mocked(useCreateResourceWizard).mockReturnValue({
      ...defaultMockContext,
      wizardType: "FixedInteger",
      defaultValue: "42",
    });

    render(<StepFourProperties />);

    const intInput = screen.getByLabelText(
      "automation.editor.resources.wizard.step4_default_value",
    );
    expect(intInput).toBeInTheDocument();
    expect(intInput).toHaveAttribute("type", "number");
    expect(intInput).toHaveValue(42);

    expect(
      screen.getByText(
        "automation.editor.resources.wizard.step4_not_empty_number",
      ),
    ).toBeInTheDocument();
  });

  it("renders RandomInteger min/max bounds correctly", () => {
    vi.mocked(useCreateResourceWizard).mockReturnValue({
      ...defaultMockContext,
      wizardType: "RandomInteger",
      minInteger: 10,
      maxInteger: 50,
    });

    render(<StepFourProperties />);

    const minInput = screen.getByLabelText(
      "automation.editor.resources.wizard.step4_min_value",
    );
    const maxInput = screen.getByLabelText(
      "automation.editor.resources.wizard.step4_max_value",
    );

    expect(minInput).toBeInTheDocument();
    expect(minInput).toHaveValue(10);
    expect(maxInput).toBeInTheDocument();
    expect(maxInput).toHaveValue(50);
  });

  it("renders LinesFromFile path and browse button correctly", () => {
    const handleBrowseFileMock = vi.fn();
    vi.mocked(useCreateResourceWizard).mockReturnValue({
      ...defaultMockContext,
      wizardType: "LinesFromFile",
      filePath: "C:\\path\\to\\file.txt",
      handleBrowseFile: handleBrowseFileMock,
    });

    render(<StepFourProperties />);

    const fileInput = screen.getByLabelText(
      "automation.editor.resources.wizard.step4_file_path",
    );
    expect(fileInput).toBeInTheDocument();
    expect(fileInput).toHaveValue("C:\\path\\to\\file.txt");

    const browseBtn = screen.getByRole("button", {
      name: "automation.editor.resources.wizard.step4_btn_choose_file",
    });
    expect(browseBtn).toBeInTheDocument();

    fireEvent.click(browseBtn);
    expect(handleBrowseFileMock).toHaveBeenCalledOnce();
  });

  it("renders LinesFromUrl input field correctly", () => {
    vi.mocked(useCreateResourceWizard).mockReturnValue({
      ...defaultMockContext,
      wizardType: "LinesFromUrl",
      url: "https://example.com/api",
    });

    render(<StepFourProperties />);

    const urlInput = screen.getByLabelText(
      "automation.editor.resources.wizard.step4_url",
    );
    expect(urlInput).toBeInTheDocument();
    expect(urlInput).toHaveValue("https://example.com/api");
  });

  it("renders Select options configuration correctly", () => {
    vi.mocked(useCreateResourceWizard).mockReturnValue({
      ...defaultMockContext,
      wizardType: "Select",
      selectType: "Combo",
      selectOptions: "Option A\nOption B",
      selectDefaultValue: "Option A",
    });

    render(<StepFourProperties />);

    expect(
      screen.getByLabelText(
        "automation.editor.resources.wizard.step4_select_type",
      ),
    ).toBeInTheDocument();

    const optionsArea = screen.getByLabelText(
      "automation.editor.resources.wizard.step4_select_options",
    );
    expect(optionsArea).toBeInTheDocument();
    expect(optionsArea).toHaveValue("Option A\nOption B");
  });

  it("renders Database connection string input correctly", () => {
    vi.mocked(useCreateResourceWizard).mockReturnValue({
      ...defaultMockContext,
      wizardType: "Database",
      dbConnection: "postgres://localhost",
    });

    render(<StepFourProperties />);

    const dbInput = screen.getByLabelText(
      "automation.editor.resources.wizard.step4_connection_string",
    );
    expect(dbInput).toBeInTheDocument();
    expect(dbInput).toHaveValue("postgres://localhost");
  });

  it("renders Information display message configuration correctly", () => {
    vi.mocked(useCreateResourceWizard).mockReturnValue({
      ...defaultMockContext,
      wizardType: "Information",
      infoMessage: "Hello info",
    });

    render(<StepFourProperties />);

    const infoArea = screen.getByLabelText(
      "automation.editor.resources.wizard.step4_message",
    );
    expect(infoArea).toBeInTheDocument();
    expect(infoArea).toHaveValue("Hello info");
  });
});
