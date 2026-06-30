import { LuCookie, LuDatabase, LuTrash2 } from "react-icons/lu";
import type { AutomationNodeCatalogItem } from "../node-catalog";

export const COOKIE_CATALOG: AutomationNodeCatalogItem[] = [
  {
    type: "getCookies",
    group: "utility",
    labelKey: "automation.nodes.getCookies.label",
    descriptionKey: "automation.nodes.getCookies.description",
    documentKey: "automation.nodes.getCookies.document",
    icon: LuCookie,
    params: [
      {
        key: "domain",
        kind: "string",
        required: false,
        placeholder: "https://facebook.com",
        supportsExpression: true,
      },
      {
        key: "saveToVar",
        kind: "string",
        required: true,
        placeholder: "FB_COOKIES",
      },
    ],
    defaults: { saveToVar: "MY_COOKIES" },
  },
  {
    type: "setCookies",
    group: "utility",
    labelKey: "automation.nodes.setCookies.label",
    descriptionKey: "automation.nodes.setCookies.description",
    documentKey: "automation.nodes.setCookies.document",
    icon: LuDatabase,
    params: [
      {
        key: "cookieJson",
        kind: "string",
        required: true,
        multiline: true,
        placeholder: "[{...}] or {{FB_COOKIES}}",
        supportsExpression: true,
      },
    ],
    defaults: { cookieJson: "" },
  },
  {
    type: "clearCookies",
    group: "utility",
    labelKey: "automation.nodes.clearCookies.label",
    descriptionKey: "automation.nodes.clearCookies.description",
    documentKey: "automation.nodes.clearCookies.document",
    icon: LuTrash2,
    params: [],
    defaults: {},
  },
];
