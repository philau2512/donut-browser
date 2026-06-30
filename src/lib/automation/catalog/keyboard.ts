import {
  LuEraser,
  LuKeyboard,
  LuPenTool,
  LuTextCursorInput,
} from "react-icons/lu";
import type { AutomationNodeCatalogItem } from "../node-catalog";

export const KEYBOARD_CATALOG: AutomationNodeCatalogItem[] = [
  {
    type: "typeText",
    group: "keyboard",
    labelKey: "automation.nodes.typeText.label",
    descriptionKey: "automation.nodes.typeText.description",
    documentKey: "automation.nodes.typeText.document",
    icon: LuTextCursorInput,
    params: [
      {
        key: "text",
        kind: "string",
        required: true,
        placeholder: "{{EMAIL}}",
        supportsExpression: true,
      },
      { key: "intervalMs", kind: "number", placeholder: "100" },
      { key: "delay", kind: "number", placeholder: "100" },
    ],
    defaults: { text: "", intervalMs: 0 },
  },
  {
    type: "sendTextToSelector",
    group: "keyboard",
    labelKey: "automation.nodes.sendTextToSelector.label",
    descriptionKey: "automation.nodes.sendTextToSelector.description",
    documentKey: "automation.nodes.sendTextToSelector.document",
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
    type: "pressKey",
    group: "keyboard",
    labelKey: "automation.nodes.pressKey.label",
    descriptionKey: "automation.nodes.pressKey.description",
    documentKey: "automation.nodes.pressKey.document",
    icon: LuPenTool,
    params: [
      {
        key: "key",
        kind: "string",
        required: true,
        placeholder: "Enter",
      },
      {
        key: "selector",
        kind: "string",
        required: false,
        placeholder: "body",
        supportsExpression: true,
      },
    ],
    defaults: { key: "Enter" },
  },
  {
    type: "clearInput",
    group: "keyboard",
    labelKey: "automation.nodes.clearInput.label",
    descriptionKey: "automation.nodes.clearInput.description",
    documentKey: "automation.nodes.clearInput.document",
    icon: LuEraser,
    params: [
      {
        key: "selector",
        kind: "string",
        required: true,
        placeholder: "input[name=username]",
        supportsExpression: true,
      },
      { key: "timeout", kind: "number", placeholder: "30000" },
    ],
    defaults: { selector: "input" },
  },
];
