// Phase 6: Network & Advanced — frontend catalog
// http, setUserAgent, getUrl, convertingJson, imageSearch

import { FiCode, FiGlobe, FiImage, FiLink, FiUser } from "react-icons/fi";
import type { AutomationNodeCatalogItem } from "../node-catalog";

const HTTP_METHOD_OPTIONS = [
  { value: "GET" },
  { value: "POST" },
  { value: "PUT" },
  { value: "PATCH" },
  { value: "DELETE" },
];

const JSON_OPERATION_OPTIONS = [
  { value: "parse", labelKey: "automation.nodes.convertingJson.options.parse" },
  {
    value: "stringify",
    labelKey: "automation.nodes.convertingJson.options.stringify",
  },
];

export const NETWORK_CATALOG: AutomationNodeCatalogItem[] = [
  {
    type: "http",
    group: "network",
    labelKey: "automation.nodes.http.label",
    descriptionKey: "automation.nodes.http.description",
    documentKey: "automation.nodes.http.document",
    icon: FiGlobe,
    params: [
      {
        key: "url",
        kind: "string",
        required: true,
        placeholder: "https://api.example.com/data",
        supportsExpression: true,
        labelKey: "automation.nodes.http.params.url",
      },
      {
        key: "method",
        kind: "enum",
        required: false,
        placeholder: "GET",
        labelKey: "automation.nodes.http.params.method",
        options: HTTP_METHOD_OPTIONS,
      },
      {
        key: "headers",
        kind: "string",
        required: false,
        multiline: true,
        placeholder: '{"Authorization": "Bearer {{TOKEN}}"}',
        supportsExpression: true,
        labelKey: "automation.nodes.http.params.headers",
      },
      {
        key: "body",
        kind: "string",
        required: false,
        multiline: true,
        placeholder: '{"key": "value"}',
        supportsExpression: true,
        labelKey: "automation.nodes.http.params.body",
      },
      {
        key: "saveToVar",
        kind: "string",
        required: false,
        placeholder: "responseBody",
        labelKey: "automation.nodes.http.params.saveToVar",
      },
      {
        key: "timeout",
        kind: "number",
        required: false,
        placeholder: "30000",
        labelKey: "automation.nodes.http.params.timeout",
      },
    ],
    defaults: { method: "GET", timeout: 30000 },
  },
  {
    type: "setUserAgent",
    group: "network",
    labelKey: "automation.nodes.setUserAgent.label",
    descriptionKey: "automation.nodes.setUserAgent.description",
    documentKey: "automation.nodes.setUserAgent.document",
    icon: FiUser,
    params: [
      {
        key: "userAgent",
        kind: "string",
        required: true,
        placeholder: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)...",
        supportsExpression: true,
        labelKey: "automation.nodes.setUserAgent.params.userAgent",
      },
    ],
    defaults: {},
  },
  {
    type: "getUrl",
    group: "network",
    labelKey: "automation.nodes.getUrl.label",
    descriptionKey: "automation.nodes.getUrl.description",
    documentKey: "automation.nodes.getUrl.document",
    icon: FiLink,
    params: [
      {
        key: "saveToVar",
        kind: "string",
        required: true,
        placeholder: "currentUrl",
        labelKey: "automation.nodes.getUrl.params.saveToVar",
      },
    ],
    defaults: {},
  },
  {
    type: "convertingJson",
    group: "network",
    labelKey: "automation.nodes.convertingJson.label",
    descriptionKey: "automation.nodes.convertingJson.description",
    documentKey: "automation.nodes.convertingJson.document",
    icon: FiCode,
    params: [
      {
        key: "input",
        kind: "string",
        required: true,
        multiline: true,
        supportsExpression: true,
        placeholder: '{"key": "value"} or {{responseBody}}',
        labelKey: "automation.nodes.convertingJson.params.input",
      },
      {
        key: "operation",
        kind: "enum",
        required: true,
        placeholder: "parse",
        labelKey: "automation.nodes.convertingJson.params.operation",
        options: JSON_OPERATION_OPTIONS,
      },
      {
        key: "saveToVar",
        kind: "string",
        required: true,
        placeholder: "jsonResult",
        labelKey: "automation.nodes.convertingJson.params.saveToVar",
      },
    ],
    defaults: { operation: "parse" },
  },
  {
    type: "imageSearch",
    group: "network",
    labelKey: "automation.nodes.imageSearch.label",
    descriptionKey: "automation.nodes.imageSearch.description",
    documentKey: "automation.nodes.imageSearch.document",
    icon: FiImage,
    params: [
      {
        key: "imagePath",
        kind: "string",
        required: true,
        placeholder: "images/button.png",
        supportsExpression: true,
        labelKey: "automation.nodes.imageSearch.params.imagePath",
      },
      {
        key: "saveToVar",
        kind: "string",
        required: true,
        placeholder: "matchResult",
        labelKey: "automation.nodes.imageSearch.params.saveToVar",
      },
      {
        key: "threshold",
        kind: "number",
        required: false,
        placeholder: "0.9",
        labelKey: "automation.nodes.imageSearch.params.threshold",
      },
    ],
    defaults: { threshold: 0.9 },
  },
];
