"use client";

import { open as openTauriDialog } from "@tauri-apps/plugin-dialog";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  makeDefaultResourceDefinition,
  type ResourceDefinition,
} from "@/lib/automation/resource-schema";

interface CreateResourceWizardContextType {
  step: number;
  setStep: React.Dispatch<React.SetStateAction<number>>;

  // Step 1: Name and description
  name: string;
  setName: (val: string) => void;
  descriptionEn: string;
  setDescriptionEn: (val: string) => void;
  descriptionRu: string;
  setDescriptionRu: (val: string) => void;
  enableHint: boolean;
  setEnableHint: (val: boolean) => void;

  // Step 2: Resource type
  wizardType: string;
  setWizardType: (val: string) => void;

  // Step 3: Read/Write Mode
  readWriteMode: "read" | "read-delete" | "write";
  setReadWriteMode: (val: "read" | "read-delete" | "write") => void;
  mixLines: boolean;
  setMixLines: (val: boolean) => void;

  // Step 4: Properties
  defaultValue: string;
  setDefaultValue: (val: string) => void;
  notEmpty: boolean;
  setNotEmpty: (val: boolean) => void;
  multiline: boolean;
  setMultiline: (val: boolean) => void;
  filePath: string;
  setFilePath: (val: string) => void;
  url: string;
  setUrl: (val: string) => void;
  selectOptions: string;
  setSelectOptions: (val: string) => void;
  selectType: "Combo" | "Radio" | "Check" | "DragAndDrop";
  setSelectType: (val: "Combo" | "Radio" | "Check" | "DragAndDrop") => void;
  selectDefaultValue: string;
  setSelectDefaultValue: (val: string) => void;
  checkboxDefault: boolean;
  setCheckboxDefault: (val: boolean) => void;
  dbConnection: string;
  setDbConnection: (val: string) => void;
  infoMessage: string;
  setInfoMessage: (val: string) => void;
  minInteger: number;
  setMinInteger: (val: number) => void;
  maxInteger: number;
  setMaxInteger: (val: number) => void;

  // Helper functions
  handleBrowseFile: () => Promise<void>;
  handleBrowseDirectory: () => Promise<void>;
  resetForm: () => void;
  handleClose: () => void;
  handleNext: () => void;
  handleBack: () => void;
  handleFinish: () => void;
  isNextDisabled: () => boolean;

  existingNames: string[];
}

const CreateResourceWizardContext = createContext<
  CreateResourceWizardContextType | undefined
>(undefined);

interface CreateResourceWizardProviderProps {
  children: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (resource: ResourceDefinition) => void;
  existingNames?: string[];
  editingResource?: ResourceDefinition | null;
}

export function CreateResourceWizardProvider({
  children,
  open,
  onOpenChange,
  onConfirm,
  existingNames = [],
  editingResource = null,
}: CreateResourceWizardProviderProps) {
  const [step, setStep] = useState(1);

  // Step 1: Name and description
  const [name, setName] = useState("");
  const [descriptionEn, setDescriptionEn] = useState("");
  const [descriptionRu, setDescriptionRu] = useState("");
  const [enableHint, setEnableHint] = useState(false);

  // Step 2: Resource type
  const [wizardType, setWizardType] = useState("FixedString");

  // Step 3: Read/Write Mode
  const [readWriteMode, setReadWriteMode] = useState<
    "read" | "read-delete" | "write"
  >("read");
  const [mixLines, setMixLines] = useState(false);

  // Step 4: Properties
  const [defaultValue, setDefaultValue] = useState("");
  const [notEmpty, setNotEmpty] = useState(false);
  const [multiline, setMultiline] = useState(false);
  const [filePath, setFilePath] = useState("");
  const [url, setUrl] = useState("");
  const [selectOptions, setSelectOptions] = useState("");
  const [selectType, setSelectType] = useState<
    "Combo" | "Radio" | "Check" | "DragAndDrop"
  >("Combo");
  const [selectDefaultValue, setSelectDefaultValue] = useState("");
  const [checkboxDefault, setCheckboxDefault] = useState(false);
  const [dbConnection, setDbConnection] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [minInteger, setMinInteger] = useState(0);
  const [maxInteger, setMaxInteger] = useState(100);

  const resetForm = useCallback(() => {
    setStep(1);
    setName("");
    setDescriptionEn("");
    setDescriptionRu("");
    setEnableHint(false);
    setWizardType("FixedString");
    setReadWriteMode("read");
    setMixLines(false);
    setDefaultValue("");
    setNotEmpty(false);
    setMultiline(false);
    setFilePath("");
    setUrl("");
    setSelectOptions("");
    setSelectType("Combo");
    setSelectDefaultValue("");
    setCheckboxDefault(false);
    setDbConnection("");
    setInfoMessage("");
    setMinInteger(0);
    setMaxInteger(100);
  }, []);

  useEffect(() => {
    if (!open) return;
    if (editingResource) {
      setName(editingResource.name);
      setDescriptionEn(editingResource.descriptionEn ?? "");
      setDescriptionRu(editingResource.descriptionRu ?? "");
      setEnableHint(editingResource.enableHint ?? false);
      setWizardType(editingResource.wizardType ?? "FixedString");

      const fileMode =
        editingResource.fileBehavior.readFile &&
        editingResource.fileBehavior.writeFile
          ? "read-write"
          : editingResource.fileBehavior.writeFile
            ? "write"
            : "read";
      setReadWriteMode(fileMode as any);
      setMixLines(editingResource.mode.selection === "mix");

      setDefaultValue(editingResource.defaultValue ?? "");
      setNotEmpty(editingResource.notEmpty ?? false);
      setMultiline(editingResource.multiline ?? false);
      setFilePath(editingResource.source.path ?? "");
      setUrl(editingResource.source.path ?? "");

      if (editingResource.wizardType === "Select") {
        setSelectOptions((editingResource.source.inlineItems ?? []).join("\n"));
        setSelectType((editingResource.selectType as any) ?? "Combo");
        setSelectDefaultValue(editingResource.selectDefaultValue ?? "");
      } else {
        setSelectOptions("");
        setSelectType("Combo");
        setSelectDefaultValue("");
      }

      setCheckboxDefault(
        editingResource.defaultValue === "true" ||
          editingResource.source.inlineItems?.[0] === "true",
      );
      setDbConnection(editingResource.source.inlineItems?.[0] ?? "");
      setInfoMessage(editingResource.source.inlineItems?.[0] ?? "");
      setMinInteger(editingResource.minInteger ?? 0);
      setMaxInteger(editingResource.maxInteger ?? 100);
      setStep(1);
    } else {
      resetForm();
    }
  }, [open, editingResource, resetForm]);

  const handleBrowseFile = async () => {
    try {
      const selected = await openTauriDialog({
        directory: false,
        multiple: false,
        title: "Select Resource File",
        filters: [{ name: "Text Files", extensions: ["txt", "csv", "log"] }],
      });
      if (selected && typeof selected === "string") {
        setFilePath(selected);
      }
    } catch (error) {
      console.error("Failed to open file dialog:", error);
    }
  };

  const handleBrowseDirectory = async () => {
    try {
      const selected = await openTauriDialog({
        directory: true,
        multiple: false,
        title: "Select Resource Directory",
      });
      if (selected && typeof selected === "string") {
        setFilePath(selected);
      }
    } catch (error) {
      console.error("Failed to open folder dialog:", error);
    }
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };

  const isFileOrUrlType = (type: string) => {
    return (
      type === "LinesFromFile" ||
      type === "FilesFromDirectory" ||
      type === "LinesFromUrl"
    );
  };

  const handleNext = () => {
    if (step === 2) {
      if (isFileOrUrlType(wizardType)) {
        setStep(3);
      } else {
        setStep(4);
      }
    } else if (step === 3) {
      setStep(4);
    } else if (step === 1) {
      setStep(2);
    } else {
      handleFinish();
    }
  };

  const handleBack = () => {
    if (step === 4) {
      if (isFileOrUrlType(wizardType)) {
        setStep(3);
      } else {
        setStep(2);
      }
    } else if (step > 1) {
      setStep((s) => s - 1);
    }
  };

  const handleFinish = () => {
    const id = editingResource ? editingResource.id : `res-${Date.now()}`;
    const tabName = editingResource ? editingResource.tabName : undefined;

    // Map wizardType to schema ResourceType
    let schemaType: ResourceDefinition["type"] = "line-pool";
    if (wizardType === "LinesFromFile" || wizardType === "FilesFromDirectory") {
      schemaType = "file";
    } else if (wizardType === "LinesFromUrl") {
      schemaType = "custom";
    }

    // Map readWriteMode to schema ResourceDirection
    let direction: ResourceDefinition["direction"] = "input";
    if (readWriteMode === "write") {
      direction = "output";
    } else if (readWriteMode === "read-delete") {
      direction = "input";
    }

    // Source properties
    let kind: "static" | "file" = "static";
    let path;
    let inlineItems: string[] = [];

    if (wizardType === "LinesFromFile" || wizardType === "FilesFromDirectory") {
      kind = "file";
      path = filePath;
    } else if (wizardType === "LinesFromUrl") {
      kind = "file";
      path = url;
    } else if (wizardType === "Select") {
      kind = "static";
      inlineItems = selectOptions
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    } else if (wizardType === "FixedString" || wizardType === "FixedInteger") {
      kind = "static";
      inlineItems = defaultValue.trim() ? [defaultValue.trim()] : [];
    } else if (wizardType === "Checkbox") {
      kind = "static";
      inlineItems = [String(checkboxDefault)];
    } else if (wizardType === "Database") {
      kind = "static";
      inlineItems = dbConnection.trim() ? [dbConnection.trim()] : [];
    } else if (wizardType === "Information") {
      kind = "static";
      inlineItems = infoMessage.trim() ? [infoMessage.trim()] : [];
    }

    const newResource = makeDefaultResourceDefinition({
      id,
      name: name.trim() || `data_input_${Date.now()}`,
      type: schemaType,
      direction,
      tabName,
      source: { kind, path, inlineItems },
      mode: {
        selection: mixLines ? "mix" : "sequential",
        greedy: false,
      },
      fileBehavior: {
        readFile: readWriteMode === "read" || readWriteMode === "read-delete",
        writeFile: readWriteMode === "write",
        reloadPeriodically: false,
        renewPeriodically: false,
      },
    });

    // Write wizard extra metadata
    Object.assign(newResource, {
      wizardType,
      descriptionEn,
      descriptionRu,
      enableHint,
      defaultValue: wizardType === "Select" ? selectDefaultValue : defaultValue,
      notEmpty,
      multiline,
      minInteger,
      maxInteger,
      selectType,
      selectDefaultValue,
    });

    onConfirm(newResource);
    handleClose();
  };

  const isNextDisabled = () => {
    if (step === 1) {
      const trimmed = name.trim();
      if (!trimmed) return true;
      // Name must be valid alphanumeric/underscore
      if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) return true;
      if (editingResource && editingResource.name === trimmed) return false;
      if (existingNames.includes(trimmed)) return true;
    }
    return false;
  };

  return (
    <CreateResourceWizardContext.Provider
      value={{
        step,
        setStep,
        name,
        setName,
        descriptionEn,
        setDescriptionEn,
        descriptionRu,
        setDescriptionRu,
        enableHint,
        setEnableHint,
        wizardType,
        setWizardType,
        readWriteMode,
        setReadWriteMode,
        mixLines,
        setMixLines,
        defaultValue,
        setDefaultValue,
        notEmpty,
        setNotEmpty,
        multiline,
        setMultiline,
        filePath,
        setFilePath,
        url,
        setUrl,
        selectOptions,
        setSelectOptions,
        selectType,
        setSelectType,
        selectDefaultValue,
        setSelectDefaultValue,
        checkboxDefault,
        setCheckboxDefault,
        dbConnection,
        setDbConnection,
        infoMessage,
        setInfoMessage,
        minInteger,
        setMinInteger,
        maxInteger,
        setMaxInteger,
        handleBrowseFile,
        handleBrowseDirectory,
        resetForm,
        handleClose,
        handleNext,
        handleBack,
        handleFinish,
        isNextDisabled,
        existingNames,
      }}
    >
      {children}
    </CreateResourceWizardContext.Provider>
  );
}

export function useCreateResourceWizard() {
  const context = useContext(CreateResourceWizardContext);
  if (context === undefined) {
    throw new Error(
      "useCreateResourceWizard must be used within a CreateResourceWizardProvider",
    );
  }
  return context;
}
