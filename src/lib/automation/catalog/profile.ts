import { RiUser3Line, RiUserUnfollowLine } from "react-icons/ri";
import type { AutomationNodeCatalogItem, ParamOption } from "../node-catalog";

const CLEANUP_MODE_OPTIONS: ParamOption[] = [
  {
    value: "cookies",
    labelKey: "automation.nodes.closeProfile.cleanupMode.cookies",
  },
  { value: "full", labelKey: "automation.nodes.closeProfile.cleanupMode.full" },
];

export const PROFILE_CATALOG: AutomationNodeCatalogItem[] = [
  {
    type: "openProfile",
    group: "navigator",
    labelKey: "automation.nodes.openProfile.label",
    descriptionKey: "automation.nodes.openProfile.description",
    documentKey: "automation.nodes.openProfile.document",
    icon: RiUser3Line,
    params: [
      {
        key: "profileId",
        kind: "string",
        required: false,
        supportsExpression: true,
        placeholder: "{{PROFILE_ID}} or profile name",
        labelKey: "automation.nodes.openProfile.params.profileId",
        helpKey: "automation.nodes.openProfile.params.profileIdHelp",
      },
      {
        key: "automation",
        kind: "string",
        required: false,
        supportsExpression: true,
        multiline: true,
        placeholder: '{"dynamicProxy": {"url": "..."}}',
        labelKey: "automation.nodes.openProfile.params.automation",
        helpKey: "automation.nodes.openProfile.params.automationHelp",
      },
    ],
    defaults: { profileId: "", automation: "" },
  },
  {
    type: "closeProfile",
    group: "navigator",
    labelKey: "automation.nodes.closeProfile.label",
    descriptionKey: "automation.nodes.closeProfile.description",
    documentKey: "automation.nodes.closeProfile.document",
    icon: RiUserUnfollowLine,
    params: [
      {
        key: "profileId",
        kind: "string",
        required: true,
        supportsExpression: true,
        placeholder: "{{PROFILE_ID}} or profile name",
        labelKey: "automation.nodes.closeProfile.params.profileId",
        helpKey: "automation.nodes.closeProfile.params.profileIdHelp",
      },
      {
        key: "cleanupMode",
        kind: "enum",
        required: true,
        labelKey: "automation.nodes.closeProfile.params.cleanupMode",
        helpKey: "automation.nodes.closeProfile.params.cleanupModeHelp",
        options: CLEANUP_MODE_OPTIONS,
      },
    ],
    defaults: { profileId: "", cleanupMode: "cookies" },
  },
];
