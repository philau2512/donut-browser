import { LuCpu, LuRefreshCcw, LuRepeat, LuSplit } from "react-icons/lu";
import type { AutomationNodeCatalogItem, ParamOption } from "../node-catalog";

const OPERATOR_OPTIONS: ParamOption[] = [
  { value: "===" },
  { value: "!==" },
  { value: "contains" },
  { value: ">" },
  { value: "<" },
];

export const LOGIC_CATALOG: AutomationNodeCatalogItem[] = [
  {
    type: "ifCondition",
    group: "utility",
    labelKey: "automation.nodes.ifCondition.label",
    descriptionKey: "automation.nodes.ifCondition.description",
    documentKey: "automation.nodes.ifCondition.document",
    icon: LuSplit,
    params: [
      {
        key: "leftValue",
        kind: "string",
        required: true,
        placeholder: "{{MY_VAR}}",
        supportsExpression: true,
      },
      {
        key: "operator",
        kind: "enum",
        placeholder: "===",
        options: OPERATOR_OPTIONS,
      },
      {
        key: "rightValue",
        kind: "string",
        required: true,
        placeholder: "active",
        supportsExpression: true,
      },
    ],
    defaults: { leftValue: "", operator: "===", rightValue: "" },
  },
  {
    type: "loopFor",
    group: "utility",
    labelKey: "automation.nodes.loopFor.label",
    descriptionKey: "automation.nodes.loopFor.description",
    documentKey: "automation.nodes.loopFor.document",
    icon: LuRepeat,
    params: [
      {
        key: "times",
        kind: "number",
        required: true,
        placeholder: "5",
      },
      {
        key: "indexVar",
        kind: "string",
        required: false,
        placeholder: "index (tên biến lưu chỉ số lặp)",
      },
    ],
    defaults: { times: 5, indexVar: "index" },
  },
  {
    type: "loopElements",
    group: "utility",
    labelKey: "automation.nodes.loopElements.label",
    descriptionKey: "automation.nodes.loopElements.description",
    documentKey: "automation.nodes.loopElements.document",
    icon: LuRefreshCcw,
    params: [
      {
        key: "selector",
        kind: "string",
        required: true,
        placeholder: "a.product-link",
        supportsExpression: true,
      },
      {
        key: "elementVar",
        kind: "string",
        required: true,
        placeholder: "item (tên biến lưu selector con)",
      },
    ],
    defaults: { selector: "", elementVar: "item" },
  },
  {
    type: "evalJs",
    group: "utility",
    labelKey: "automation.nodes.evalJs.label",
    descriptionKey: "automation.nodes.evalJs.description",
    documentKey: "automation.nodes.evalJs.document",
    icon: LuCpu,
    params: [
      {
        key: "code",
        kind: "string",
        required: true,
        multiline: true,
        placeholder: "return document.title;",
        supportsExpression: true,
      },
      {
        key: "saveToVar",
        kind: "string",
        required: false,
        placeholder: "PAGE_TITLE (tên biến lưu kết quả)",
      },
    ],
    defaults: { code: "return document.title;", saveToVar: "" },
  },
];
