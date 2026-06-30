// Phase 7: Logic & Flow Control — frontend catalog
// while, stopLoop, runOtherScript, addLog, addComment

import {
  FiFileText,
  FiMessageSquare,
  FiPlay,
  FiRepeat,
  FiStopCircle,
} from "react-icons/fi";
import type { AutomationNodeCatalogItem } from "../node-catalog";

const LOG_LEVEL_OPTIONS = [
  { value: "info" },
  { value: "warn" },
  { value: "error" },
  { value: "debug" },
];

const OPERATOR_OPTIONS = [
  { value: "===" },
  { value: "!==" },
  { value: "contains" },
  { value: "not_contains" },
  { value: "starts_with" },
  { value: "ends_with" },
  { value: ">" },
  { value: ">=" },
  { value: "<" },
  { value: "<=" },
];

export const CONTROL_FLOW_CATALOG: AutomationNodeCatalogItem[] = [
  {
    type: "while",
    group: "control",
    labelKey: "automation.nodes.while.label",
    descriptionKey: "automation.nodes.while.description",
    documentKey: "automation.nodes.while.document",
    icon: FiRepeat,
    params: [
      {
        key: "leftValue",
        kind: "string",
        required: true,
        placeholder: "{{counter}}",
        supportsExpression: true,
        labelKey: "automation.nodes.while.params.leftValue",
      },
      {
        key: "operator",
        kind: "enum",
        required: true,
        placeholder: "<",
        labelKey: "automation.nodes.while.params.operator",
        options: OPERATOR_OPTIONS,
      },
      {
        key: "rightValue",
        kind: "string",
        required: true,
        placeholder: "10",
        supportsExpression: true,
        labelKey: "automation.nodes.while.params.rightValue",
      },
    ],
    defaults: { operator: "<" },
  },
  {
    type: "stopLoop",
    group: "control",
    labelKey: "automation.nodes.stopLoop.label",
    descriptionKey: "automation.nodes.stopLoop.description",
    documentKey: "automation.nodes.stopLoop.document",
    icon: FiStopCircle,
    params: [],
    defaults: {},
  },
  {
    type: "runOtherScript",
    group: "control",
    labelKey: "automation.nodes.runOtherScript.label",
    descriptionKey: "automation.nodes.runOtherScript.description",
    documentKey: "automation.nodes.runOtherScript.document",
    icon: FiPlay,
    params: [
      {
        key: "scriptName",
        kind: "string",
        required: true,
        placeholder: "my-other-flow",
        supportsExpression: true,
        labelKey: "automation.nodes.runOtherScript.params.scriptName",
      },
      {
        key: "vars",
        kind: "string",
        required: false,
        multiline: true,
        placeholder: '{"KEY": "value"}',
        supportsExpression: true,
        labelKey: "automation.nodes.runOtherScript.params.vars",
      },
    ],
    defaults: {},
  },
  {
    type: "addLog",
    group: "control",
    labelKey: "automation.nodes.addLog.label",
    descriptionKey: "automation.nodes.addLog.description",
    documentKey: "automation.nodes.addLog.document",
    icon: FiFileText,
    params: [
      {
        key: "message",
        kind: "string",
        required: true,
        multiline: true,
        placeholder: "Step completed: {{PROFILE_NAME}}",
        supportsExpression: true,
        labelKey: "automation.nodes.addLog.params.message",
      },
      {
        key: "level",
        kind: "enum",
        required: false,
        placeholder: "info",
        labelKey: "automation.nodes.addLog.params.level",
        options: LOG_LEVEL_OPTIONS,
      },
    ],
    defaults: { level: "info" },
  },
  {
    type: "addComment",
    group: "control",
    labelKey: "automation.nodes.addComment.label",
    descriptionKey: "automation.nodes.addComment.description",
    documentKey: "automation.nodes.addComment.document",
    icon: FiMessageSquare,
    params: [
      {
        key: "comment",
        kind: "string",
        required: false,
        multiline: true,
        placeholder: "This section handles login...",
        labelKey: "automation.nodes.addComment.params.comment",
      },
    ],
    defaults: {},
  },
];
