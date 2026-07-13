import { RiCheckboxCircleLine, RiCloseCircleLine } from "react-icons/ri";
import type { AutomationNodeCatalogItem } from "../node-catalog";

export const RESULT_CATALOG: AutomationNodeCatalogItem[] = [
  {
    type: "profileSuccess",
    group: "utility",
    labelKey: "automation.nodes.profileSuccess.label",
    descriptionKey: "automation.nodes.profileSuccess.description",
    documentKey: "automation.nodes.profileSuccess.document",
    icon: RiCheckboxCircleLine,
    params: [
      {
        key: "message",
        kind: "string",
        required: false,
        supportsExpression: true,
        multiline: true,
        placeholder: "[[result]] or custom message",
        labelKey: "automation.nodes.profileSuccess.params.message",
        helpKey: "automation.nodes.profileSuccess.params.messageHelp",
      },
      {
        key: "includeResourceStats",
        kind: "boolean",
        required: false,
        labelKey: "automation.nodes.profileSuccess.params.includeResourceStats",
        helpKey:
          "automation.nodes.profileSuccess.params.includeResourceStatsHelp",
      },
      {
        key: "stopFlow",
        kind: "boolean",
        required: false,
        labelKey: "automation.nodes.profileSuccess.params.stopFlow",
        helpKey: "automation.nodes.profileSuccess.params.stopFlowHelp",
      },
    ],
    defaults: { message: "", includeResourceStats: false, stopFlow: true },
  },
  {
    type: "profileFail",
    group: "utility",
    labelKey: "automation.nodes.profileFail.label",
    descriptionKey: "automation.nodes.profileFail.description",
    documentKey: "automation.nodes.profileFail.document",
    icon: RiCloseCircleLine,
    params: [
      {
        key: "message",
        kind: "string",
        required: false,
        supportsExpression: true,
        multiline: true,
        placeholder: "[[error]] or custom message",
        labelKey: "automation.nodes.profileFail.params.message",
        helpKey: "automation.nodes.profileFail.params.messageHelp",
      },
      {
        key: "reasonCode",
        kind: "string",
        required: false,
        supportsExpression: false,
        placeholder: "e.g. LOGIN_FAILED",
        labelKey: "automation.nodes.profileFail.params.reasonCode",
        helpKey: "automation.nodes.profileFail.params.reasonCodeHelp",
      },
      {
        key: "includeLastError",
        kind: "boolean",
        required: false,
        labelKey: "automation.nodes.profileFail.params.includeLastError",
        helpKey: "automation.nodes.profileFail.params.includeLastErrorHelp",
      },
      {
        key: "includeResourceStats",
        kind: "boolean",
        required: false,
        labelKey: "automation.nodes.profileFail.params.includeResourceStats",
        helpKey: "automation.nodes.profileFail.params.includeResourceStatsHelp",
      },
      {
        key: "stopFlow",
        kind: "boolean",
        required: false,
        labelKey: "automation.nodes.profileFail.params.stopFlow",
        helpKey: "automation.nodes.profileFail.params.stopFlowHelp",
      },
    ],
    defaults: {
      message: "",
      reasonCode: "",
      includeLastError: true,
      includeResourceStats: false,
      stopFlow: true,
    },
  },
];
