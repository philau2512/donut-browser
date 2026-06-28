import { LuPuzzle } from "react-icons/lu";
import type { AutomationNodeCatalogItem, ParamOption } from "../node-catalog";

const EXTENSION_MODE_OPTIONS: ParamOption[] = [
  { value: "popup" },
  { value: "main" },
];

export const EXTENSION_CATALOG: AutomationNodeCatalogItem[] = [
  {
    type: "switchExtensionPopup",
    group: "navigator",
    labelKey: "automation.nodes.switchExtensionPopup.label",
    descriptionKey: "automation.nodes.switchExtensionPopup.description",
    documentKey: "automation.nodes.switchExtensionPopup.document",
    icon: LuPuzzle,
    params: [
      {
        key: "mode",
        kind: "enum",
        placeholder: "popup",
        options: EXTENSION_MODE_OPTIONS,
      },
      {
        key: "selector",
        kind: "string",
        required: false,
        placeholder: "#oauth-button",
        supportsExpression: true,
      },
      { key: "timeout", kind: "number", placeholder: "30000" },
    ],
    defaults: { mode: "popup", selector: "" },
  },
];
