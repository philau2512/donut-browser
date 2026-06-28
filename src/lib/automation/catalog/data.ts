import {
  LuCamera,
  LuClock,
  LuDownload,
  LuFileOutput,
  LuFileSpreadsheet,
  LuHand,
  LuText,
  LuVariable,
} from "react-icons/lu";
import type { AutomationNodeCatalogItem, ParamOption } from "../node-catalog";

const LOG_LEVEL_OPTIONS: ParamOption[] = [
  { value: "info" },
  { value: "warn" },
  { value: "error" },
  { value: "debug" },
];

const WAIT_STATE_OPTIONS: ParamOption[] = [
  { value: "visible" },
  { value: "hidden" },
  { value: "attached" },
  { value: "detached" },
];

export const DATA_CATALOG: AutomationNodeCatalogItem[] = [
  {
    type: "setVariable",
    group: "utility",
    labelKey: "automation.nodes.setVariable.label",
    descriptionKey: "automation.nodes.setVariable.description",
    documentKey: "automation.nodes.setVariable.document",
    icon: LuVariable,
    params: [
      {
        key: "name",
        kind: "string",
        required: true,
        placeholder: "MY_VAR",
      },
      {
        key: "value",
        kind: "string",
        required: true,
        placeholder: "hello world",
        supportsExpression: true,
      },
    ],
    defaults: { name: "", value: "" },
  },
  {
    type: "readCsv",
    group: "utility",
    labelKey: "automation.nodes.readCsv.label",
    descriptionKey: "automation.nodes.readCsv.description",
    documentKey: "automation.nodes.readCsv.document",
    icon: LuFileSpreadsheet,
    params: [
      {
        key: "path",
        kind: "string",
        required: true,
        placeholder: "C:/data/accounts.csv",
        supportsExpression: true,
      },
      {
        key: "saveToVar",
        kind: "string",
        required: true,
        placeholder: "CSV_ROWS (lưu dạng mảng JSON)",
      },
    ],
    defaults: { path: "", saveToVar: "CSV_ROWS" },
  },
  {
    type: "writeCsv",
    group: "utility",
    labelKey: "automation.nodes.writeCsv.label",
    descriptionKey: "automation.nodes.writeCsv.description",
    documentKey: "automation.nodes.writeCsv.document",
    icon: LuFileOutput,
    params: [
      {
        key: "path",
        kind: "string",
        required: true,
        placeholder: "C:/data/output.csv",
        supportsExpression: true,
      },
      {
        key: "data",
        kind: "string",
        required: true,
        multiline: true,
        placeholder: "{{CSV_ROWS}} hoặc dữ liệu dạng JSON",
        supportsExpression: true,
      },
    ],
    defaults: { path: "", data: "" },
  },
  {
    type: "downloadFile",
    group: "utility",
    labelKey: "automation.nodes.downloadFile.label",
    descriptionKey: "automation.nodes.downloadFile.description",
    documentKey: "automation.nodes.downloadFile.document",
    icon: LuDownload,
    params: [
      {
        key: "url",
        kind: "string",
        required: true,
        placeholder: "https://example.com/file.zip",
        supportsExpression: true,
      },
      {
        key: "savePath",
        kind: "string",
        required: true,
        placeholder: "downloads/file.zip",
        supportsExpression: true,
      },
      { key: "timeout", kind: "number", placeholder: "60000" },
    ],
    defaults: { url: "", savePath: "downloads/" },
  },
  // Tiện ích từ MVP cũ: delay, wait, log, screenshot
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
];
