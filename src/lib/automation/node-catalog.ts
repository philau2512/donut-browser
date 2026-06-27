import type { IconType } from "react-icons";
import {
  LuCamera,
  LuClock,
  LuCode,
  LuHand,
  LuKeyboard,
  LuMousePointerClick,
  LuScroll,
  LuText,
} from "react-icons/lu";

export type AutomationNodeType =
  | "openUrl"
  | "click"
  | "type"
  | "wait"
  | "scroll"
  | "screenshot"
  | "log"
  | "delay";

export type AutomationNodeGroup = "navigator" | "interaction" | "utility";

export type ParamKind = "string" | "number" | "boolean";

export interface ParamSpec {
  key: string;
  kind: ParamKind;
  required?: boolean;
  placeholder?: string;
  multiline?: boolean;
}

export interface AutomationNodeCatalogItem {
  type: AutomationNodeType;
  group: AutomationNodeGroup;
  labelKey: string;
  descriptionKey: string;
  icon: IconType;
  params: ParamSpec[];
  defaults: Record<string, string | number | boolean>;
}

/** FE catalog mirrors automation-engine/lib/validate.mjs NODE_SCHEMAS.
 * Keep node type + param names in lockstep with the engine validator; the saved
 * JSON still goes through `write_automation_flow` so the backend remains the real
 * validation gate. */
export const AUTOMATION_NODE_CATALOG: AutomationNodeCatalogItem[] = [
  {
    type: "openUrl",
    group: "navigator",
    labelKey: "automation.nodes.openUrl.label",
    descriptionKey: "automation.nodes.openUrl.description",
    icon: LuCode,
    params: [
      {
        key: "url",
        kind: "string",
        required: true,
        placeholder: "https://example.com",
      },
      { key: "timeout", kind: "number", placeholder: "30000" },
      { key: "waitUntil", kind: "string", placeholder: "domcontentloaded" },
    ],
    defaults: { url: "https://example.com" },
  },
  {
    type: "click",
    group: "interaction",
    labelKey: "automation.nodes.click.label",
    descriptionKey: "automation.nodes.click.description",
    icon: LuMousePointerClick,
    params: [
      {
        key: "selector",
        kind: "string",
        required: true,
        placeholder: "button[type=submit]",
      },
      { key: "timeout", kind: "number", placeholder: "30000" },
      { key: "button", kind: "string", placeholder: "left" },
      { key: "clickCount", kind: "number", placeholder: "1" },
    ],
    defaults: { selector: "button" },
  },
  {
    type: "type",
    group: "interaction",
    labelKey: "automation.nodes.type.label",
    descriptionKey: "automation.nodes.type.description",
    icon: LuKeyboard,
    params: [
      {
        key: "selector",
        kind: "string",
        required: true,
        placeholder: "input[name=email]",
      },
      { key: "text", kind: "string", required: true, placeholder: "{{EMAIL}}" },
      { key: "timeout", kind: "number", placeholder: "30000" },
      { key: "delay", kind: "number", placeholder: "25" },
    ],
    defaults: { selector: "input", text: "" },
  },
  {
    type: "wait",
    group: "navigator",
    labelKey: "automation.nodes.wait.label",
    descriptionKey: "automation.nodes.wait.description",
    icon: LuClock,
    params: [
      { key: "selector", kind: "string", placeholder: ".ready" },
      { key: "timeout", kind: "number", placeholder: "1000" },
      { key: "state", kind: "string", placeholder: "visible" },
    ],
    defaults: { timeout: 1000 },
  },
  {
    type: "scroll",
    group: "navigator",
    labelKey: "automation.nodes.scroll.label",
    descriptionKey: "automation.nodes.scroll.description",
    icon: LuScroll,
    params: [
      { key: "selector", kind: "string", placeholder: "body" },
      { key: "x", kind: "number", placeholder: "0" },
      { key: "y", kind: "number", placeholder: "600" },
    ],
    defaults: { x: 0, y: 600 },
  },
  {
    type: "screenshot",
    group: "utility",
    labelKey: "automation.nodes.screenshot.label",
    descriptionKey: "automation.nodes.screenshot.description",
    icon: LuCamera,
    params: [
      { key: "path", kind: "string", placeholder: "screenshots/page.png" },
      { key: "fullPage", kind: "boolean" },
    ],
    defaults: { fullPage: true },
  },
  {
    type: "log",
    group: "utility",
    labelKey: "automation.nodes.log.label",
    descriptionKey: "automation.nodes.log.description",
    icon: LuText,
    params: [
      {
        key: "message",
        kind: "string",
        required: true,
        multiline: true,
        placeholder: "Reached checkout",
      },
      { key: "level", kind: "string", placeholder: "info" },
    ],
    defaults: { message: "Log message" },
  },
  {
    type: "delay",
    group: "utility",
    labelKey: "automation.nodes.delay.label",
    descriptionKey: "automation.nodes.delay.description",
    icon: LuHand,
    params: [
      { key: "ms", kind: "number", required: true, placeholder: "1000" },
    ],
    defaults: { ms: 1000 },
  },
];

export const AUTOMATION_NODE_BY_TYPE = Object.fromEntries(
  AUTOMATION_NODE_CATALOG.map((item) => [item.type, item]),
) as Record<AutomationNodeType, AutomationNodeCatalogItem>;

export function isAutomationNodeType(
  value: string,
): value is AutomationNodeType {
  return value in AUTOMATION_NODE_BY_TYPE;
}
