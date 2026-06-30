import {
  LuArrowLeft,
  LuArrowRight,
  LuCode,
  LuExternalLink,
  LuFrame,
  LuLayers,
  LuRefreshCw,
  LuX,
} from "react-icons/lu";
import type { AutomationNodeCatalogItem, ParamOption } from "../node-catalog";

const WAIT_UNTIL_OPTIONS: ParamOption[] = [
  { value: "load" },
  { value: "domcontentloaded" },
  { value: "networkidle" },
];

const MATCH_MODE_OPTIONS: ParamOption[] = [
  { value: "contain" },
  { value: "equal" },
];

const FRAME_MODE_OPTIONS: ParamOption[] = [{ value: "sub" }, { value: "main" }];

export const NAVIGATOR_CATALOG: AutomationNodeCatalogItem[] = [
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
    type: "newTab",
    group: "navigator",
    labelKey: "automation.nodes.newTab.label",
    descriptionKey: "automation.nodes.newTab.description",
    documentKey: "automation.nodes.newTab.document",
    icon: LuExternalLink,
    params: [
      {
        key: "url",
        kind: "string",
        required: false,
        placeholder: "https://example.com",
        supportsExpression: true,
      },
      { key: "timeout", kind: "number", placeholder: "30000" },
    ],
    defaults: { url: "" },
  },
  {
    type: "switchTab",
    group: "navigator",
    labelKey: "automation.nodes.switchTab.label",
    descriptionKey: "automation.nodes.switchTab.description",
    documentKey: "automation.nodes.switchTab.document",
    icon: LuLayers,
    params: [
      {
        key: "tabIndex",
        kind: "number",
        required: false,
        placeholder: "1",
        helpKey: "automation.nodes.switchTab.tabIndexHelp",
      },
      {
        key: "urlFilter",
        kind: "string",
        required: false,
        placeholder: "facebook",
        supportsExpression: true,
      },
      {
        key: "urlMode",
        kind: "enum",
        placeholder: "contain",
        options: MATCH_MODE_OPTIONS,
      },
      {
        key: "titleFilter",
        kind: "string",
        required: false,
        placeholder: "Facebook",
        supportsExpression: true,
      },
      {
        key: "titleMode",
        kind: "enum",
        placeholder: "contain",
        options: MATCH_MODE_OPTIONS,
      },
      {
        key: "index",
        kind: "number",
        required: false,
        placeholder: "0",
      },
      {
        key: "urlPattern",
        kind: "string",
        required: false,
        placeholder: "google.com",
        supportsExpression: true,
      },
    ],
    defaults: { tabIndex: 1, urlMode: "contain", titleMode: "contain" },
  },
  {
    type: "closeTab",
    group: "navigator",
    labelKey: "automation.nodes.closeTab.label",
    descriptionKey: "automation.nodes.closeTab.description",
    documentKey: "automation.nodes.closeTab.document",
    icon: LuX,
    params: [],
    defaults: {},
  },
  {
    type: "reloadPage",
    group: "navigator",
    labelKey: "automation.nodes.reloadPage.label",
    descriptionKey: "automation.nodes.reloadPage.description",
    documentKey: "automation.nodes.reloadPage.document",
    icon: LuRefreshCw,
    params: [],
    defaults: {},
  },
  {
    type: "goBack",
    group: "navigator",
    labelKey: "automation.nodes.goBack.label",
    descriptionKey: "automation.nodes.goBack.description",
    documentKey: "automation.nodes.goBack.document",
    icon: LuArrowLeft,
    params: [],
    defaults: {},
  },
  {
    type: "goForward",
    group: "navigator",
    labelKey: "automation.nodes.goForward.label",
    descriptionKey: "automation.nodes.goForward.description",
    documentKey: "automation.nodes.goForward.document",
    icon: LuArrowRight,
    params: [],
    defaults: {},
  },
  {
    type: "switchFrame",
    group: "navigator",
    labelKey: "automation.nodes.switchFrame.label",
    descriptionKey: "automation.nodes.switchFrame.description",
    documentKey: "automation.nodes.switchFrame.document",
    icon: LuFrame,
    params: [
      {
        key: "mode",
        kind: "enum",
        placeholder: "sub",
        options: FRAME_MODE_OPTIONS,
      },
      {
        key: "selector",
        kind: "string",
        required: false,
        placeholder: "#iframe-id",
        supportsExpression: true,
      },
      { key: "timeout", kind: "number", placeholder: "30000" },
    ],
    defaults: { mode: "sub", selector: "#iframe-id" },
  },
];
