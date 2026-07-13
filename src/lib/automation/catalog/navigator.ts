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

const TAB_MATCH_BY_OPTIONS: ParamOption[] = [
  { value: "url", labelKey: "automation.nodes.switchTab.matchBy.url" },
  { value: "title", labelKey: "automation.nodes.switchTab.matchBy.title" },
  { value: "index", labelKey: "automation.nodes.switchTab.matchBy.index" },
];

const CLOSE_TAB_TARGET_OPTIONS: ParamOption[] = [
  { value: "current", labelKey: "automation.nodes.closeTab.target.current" },
  { value: "select", labelKey: "automation.nodes.closeTab.target.select" },
  { value: "other", labelKey: "automation.nodes.closeTab.target.other" },
];

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
      { key: "timeout", kind: "number", placeholder: "60000" },
      {
        key: "waitUntil",
        kind: "enum",
        placeholder: "domcontentloaded",
        options: WAIT_UNTIL_OPTIONS,
      },
      {
        key: "retryOnFail",
        kind: "boolean",
        labelKey: "automation.nodes.openUrl.retryOnFail",
        helpKey: "automation.nodes.openUrl.retryOnFailHelp",
      },
      {
        key: "maxRetry",
        kind: "number",
        placeholder: "3",
        labelKey: "automation.nodes.openUrl.maxRetry",
        showIf: { key: "retryOnFail", value: true },
      },
      {
        key: "retrySleep",
        kind: "number",
        placeholder: "1000",
        labelKey: "automation.nodes.openUrl.retrySleep",
        helpKey: "automation.nodes.openUrl.retrySleepHelp",
        showIf: { key: "retryOnFail", value: true },
      },
    ],
    defaults: {
      url: "https://example.com",
      timeout: 60000,
      waitUntil: "domcontentloaded",
      retryOnFail: false,
      maxRetry: 3,
      retrySleep: 1000,
    },
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
      { key: "timeout", kind: "number", placeholder: "60000" },
    ],
    defaults: { url: "", timeout: 60000 },
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
        key: "matchBy",
        kind: "enum",
        placeholder: "url",
        options: TAB_MATCH_BY_OPTIONS,
      },
      {
        key: "matchValue",
        kind: "string",
        required: false,
        placeholder: "facebook",
        supportsExpression: true,
      },
      {
        key: "matchMode",
        kind: "enum",
        placeholder: "contain",
        options: MATCH_MODE_OPTIONS,
      },
    ],
    defaults: { matchBy: "url", matchMode: "contain", matchValue: "" },
  },
  {
    type: "closeTab",
    group: "navigator",
    labelKey: "automation.nodes.closeTab.label",
    descriptionKey: "automation.nodes.closeTab.description",
    documentKey: "automation.nodes.closeTab.document",
    icon: LuX,
    params: [
      {
        key: "target",
        kind: "enum",
        placeholder: "current",
        options: CLOSE_TAB_TARGET_OPTIONS,
      },
      {
        key: "tabIndex",
        kind: "number",
        required: false,
        placeholder: "1",
      },
    ],
    defaults: { target: "current", tabIndex: 1 },
  },
  {
    type: "reloadPage",
    group: "navigator",
    labelKey: "automation.nodes.reloadPage.label",
    descriptionKey: "automation.nodes.reloadPage.description",
    documentKey: "automation.nodes.reloadPage.document",
    icon: LuRefreshCw,
    params: [{ key: "timeout", kind: "number", placeholder: "60000" }],
    defaults: { timeout: 60000 },
  },
  {
    type: "goBack",
    group: "navigator",
    labelKey: "automation.nodes.goBack.label",
    descriptionKey: "automation.nodes.goBack.description",
    documentKey: "automation.nodes.goBack.document",
    icon: LuArrowLeft,
    params: [{ key: "timeout", kind: "number", placeholder: "60000" }],
    defaults: { timeout: 60000 },
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
        kind: "selector",
        required: false,
        placeholder: "#iframe-id",
        supportsExpression: true,
      },
      { key: "timeout", kind: "number", placeholder: "60000" },
    ],
    defaults: { mode: "sub", selector: "#iframe-id", timeout: 60000 },
  },
];
