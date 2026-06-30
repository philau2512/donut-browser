import type { IconType } from "react-icons";

export type AutomationNodeType =
  | "openUrl"
  | "newTab"
  | "switchTab"
  | "closeTab"
  | "reloadPage"
  | "goBack"
  | "goForward"
  | "switchFrame"
  | "click"
  | "hover"
  | "scroll"
  | "dragAndDrop"
  | "clickDown"
  | "clickUp"
  | "type"
  | "pressKey"
  | "clearInput"
  | "typeText"
  | "sendTextToSelector"
  | "getCookies"
  | "setCookies"
  | "clearCookies"
  | "ifCondition"
  | "loopFor"
  | "loopElements"
  | "evalJs"
  | "setVariable"
  | "readCsv"
  | "writeCsv"
  | "downloadFile"
  | "delay"
  | "wait"
  | "screenshot"
  | "log"
  // Phase 5: Data Extraction & DOM Inspection
  | "getText"
  | "getAttributeValue"
  | "getValue"
  | "elementExists"
  | "extractionInText"
  | "random"
  // Phase 6: Network & Advanced
  | "http"
  | "setUserAgent"
  | "getUrl"
  | "convertingJson"
  | "imageSearch"
  // Phase 7: Logic & Flow Control
  | "while"
  | "stopLoop"
  | "runOtherScript"
  | "addLog"
  | "addComment"
  // Extension (spike)
  | "switchExtensionPopup";

export type AutomationNodeGroup =
  | "navigator"
  | "mouse"
  | "keyboard"
  | "data"
  | "network"
  | "other"
  | "utility"
  | "control"
  | "interaction";

export type ParamKind = "string" | "number" | "boolean" | "enum";

export interface ParamOption {
  value: string;
  labelKey?: string;
}

export interface ParamSpec {
  key: string;
  kind: ParamKind;
  required?: boolean;
  placeholder?: string;
  multiline?: boolean;
  supportsExpression?: boolean;
  options?: ParamOption[];
  labelKey?: string;
  helpKey?: string;
}

export interface AutomationNodeCatalogItem {
  type: AutomationNodeType;
  group: AutomationNodeGroup;
  labelKey: string;
  descriptionKey: string;
  documentKey: string;
  icon: IconType;
  params: ParamSpec[];
  defaults: Record<string, string | number | boolean>;
}

import { CONTROL_FLOW_CATALOG } from "./catalog/control-flow";
import { COOKIE_CATALOG } from "./catalog/cookie";
import { DATA_CATALOG } from "./catalog/data";
import { EXTENSION_CATALOG } from "./catalog/extension";
import { EXTRACTION_CATALOG } from "./catalog/extraction";
import { INTERACTION_CATALOG } from "./catalog/interaction";
import { KEYBOARD_CATALOG } from "./catalog/keyboard";
import { LOGIC_CATALOG } from "./catalog/logic";
import { NAVIGATOR_CATALOG } from "./catalog/navigator";
import { NETWORK_CATALOG } from "./catalog/network";

/** FE catalog mirrors automation-engine/lib/validate.mjs NODE_SCHEMAS.
 * Keep node type + param names in lockstep with the engine validator. */
export const AUTOMATION_NODE_CATALOG: AutomationNodeCatalogItem[] = [
  ...NAVIGATOR_CATALOG,
  ...EXTENSION_CATALOG,
  ...KEYBOARD_CATALOG,
  ...INTERACTION_CATALOG,
  ...COOKIE_CATALOG,
  ...LOGIC_CATALOG,
  ...DATA_CATALOG,
  ...EXTRACTION_CATALOG,
  ...NETWORK_CATALOG,
  ...CONTROL_FLOW_CATALOG,
];

export const AUTOMATION_NODE_BY_TYPE = Object.fromEntries(
  AUTOMATION_NODE_CATALOG.map((item) => [item.type, item]),
) as Record<AutomationNodeType, AutomationNodeCatalogItem>;

export function isAutomationNodeType(
  value: string | null | undefined,
): value is AutomationNodeType {
  return typeof value === "string" && value in AUTOMATION_NODE_BY_TYPE;
}
