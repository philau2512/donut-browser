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

const BUTTON_OPTIONS: ParamOption[] = [
  { value: "left" },
  { value: "right" },
  { value: "middle" },
];

const WAIT_UNTIL_OPTIONS: ParamOption[] = [
  { value: "load" },
  { value: "domcontentloaded" },
  { value: "networkidle" },
];

const WAIT_STATE_OPTIONS: ParamOption[] = [
  { value: "visible" },
  { value: "hidden" },
  { value: "attached" },
  { value: "detached" },
];

const LOG_LEVEL_OPTIONS: ParamOption[] = [
  { value: "info" },
  { value: "warn" },
  { value: "error" },
  { value: "debug" },
];

/** FE catalog mirrors automation-engine/lib/validate.mjs NODE_SCHEMAS.
 * Keep node type + param names in lockstep with the engine validator; enum
 * choices are UI-only because the engine currently validates those params as
 * strings. Saved JSON still goes through `write_automation_flow`, so the backend
 * remains the real validation gate. */
export const AUTOMATION_NODE_CATALOG: AutomationNodeCatalogItem[] = [
  {
    type: "openUrl",
    group: "navigator",
    labelKey: "automation.nodes.openUrl.label",
    descriptionKey: "automation.nodes.openUrl.description",
    documentKey: "automation.nodes.openUrl.document",
    icon: LuCode,
    params: [
      {
        key: "url",
        kind: "string",
        required: true,
        placeholder: "https://example.com",
        supportsExpression: true,
      },
      { key: "timeout", kind: "number", placeholder: "30000" },
      {
        key: "waitUntil",
        kind: "enum",
        placeholder: "domcontentloaded",
        options: WAIT_UNTIL_OPTIONS,
      },
    ],
    defaults: { url: "https://example.com" },
  },
  {
    type: "click",
    group: "interaction",
    labelKey: "automation.nodes.click.label",
    descriptionKey: "automation.nodes.click.description",
    documentKey: "automation.nodes.click.document",
    icon: LuMousePointerClick,
    params: [
      {
        key: "selector",
        kind: "string",
        required: true,
        placeholder: "button[type=submit]",
        supportsExpression: true,
      },
      { key: "timeout", kind: "number", placeholder: "30000" },
      {
        key: "button",
        kind: "enum",
        placeholder: "left",
        options: BUTTON_OPTIONS,
      },
      { key: "clickCount", kind: "number", placeholder: "1" },
    ],
    defaults: { selector: "button" },
  },
  {
    type: "type",
    group: "interaction",
    labelKey: "automation.nodes.type.label",
    descriptionKey: "automation.nodes.type.description",
    documentKey: "automation.nodes.type.document",
    icon: LuKeyboard,
    params: [
      {
        key: "selector",
        kind: "string",
        required: true,
        placeholder: "input[name=email]",
        supportsExpression: true,
      },
      {
        key: "text",
        kind: "string",
        required: true,
        placeholder: "{{EMAIL}}",
        supportsExpression: true,
      },
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
    documentKey: "automation.nodes.wait.document",
    icon: LuClock,
    params: [
      {
        key: "selector",
        kind: "string",
        placeholder: ".ready",
        supportsExpression: true,
      },
      { key: "timeout", kind: "number", placeholder: "1000" },
      {
        key: "state",
        kind: "enum",
        placeholder: "visible",
        options: WAIT_STATE_OPTIONS,
      },
    ],
    defaults: { timeout: 1000 },
  },
  {
    type: "scroll",
    group: "navigator",
    labelKey: "automation.nodes.scroll.label",
    descriptionKey: "automation.nodes.scroll.description",
    documentKey: "automation.nodes.scroll.document",
    icon: LuScroll,
    params: [
      {
        key: "selector",
        kind: "string",
        placeholder: "body",
        supportsExpression: true,
      },
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
    documentKey: "automation.nodes.screenshot.document",
    icon: LuCamera,
    params: [
      {
        key: "path",
        kind: "string",
        placeholder: "screenshots/page.png",
        supportsExpression: true,
      },
      { key: "fullPage", kind: "boolean" },
    ],
    defaults: { fullPage: true },
  },
  {
    type: "log",
    group: "utility",
    labelKey: "automation.nodes.log.label",
    descriptionKey: "automation.nodes.log.description",
    documentKey: "automation.nodes.log.document",
    icon: LuText,
    params: [
      {
        key: "message",
        kind: "string",
        required: true,
        multiline: true,
        placeholder: "Reached checkout",
        supportsExpression: true,
      },
      {
        key: "level",
        kind: "enum",
        placeholder: "info",
        options: LOG_LEVEL_OPTIONS,
      },
    ],
    defaults: { message: "Log message" },
  },
  {
    type: "delay",
    group: "utility",
    labelKey: "automation.nodes.delay.label",
    descriptionKey: "automation.nodes.delay.description",
    documentKey: "automation.nodes.delay.document",
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
