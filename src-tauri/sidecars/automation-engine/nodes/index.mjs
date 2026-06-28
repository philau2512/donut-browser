import { openUrl, newTab, switchTab, closeTab, reloadPage, goBack, goForward, switchFrame, wait, scroll } from "./navigator.mjs";
import { click, hover, dragAndDrop, clickDown, clickUp, type } from "./interaction.mjs";
import { typeText, sendTextToSelector, pressKey, clearInput } from "./keyboard.mjs";
import { getCookies, setCookies, clearCookies } from "./cookie.mjs";
import { ifCondition, loopFor, loopElements, evalJs } from "./logic.mjs";
import { setVariable, readCsv, writeCsv, downloadFile, screenshot, log, delay } from "./data.mjs";
import { getText, getAttributeValue, getValue, elementExists, extractionInText, random } from "./extraction.mjs";
import { http, setUserAgent, getUrl, convertingJson, imageSearch } from "./network.mjs";
import { whileLoop, stopLoop, runOtherScript, addLog, addComment } from "./control-flow.mjs";
import { switchExtensionPopup } from "./extension.mjs";

export const handlers = {
  // Navigator
  openUrl,
  newTab,
  switchTab,
  closeTab,
  reloadPage,
  goBack,
  goForward,
  switchFrame,
  wait,
  scroll,

  // Interaction
  click,
  hover,
  dragAndDrop,
  clickDown,
  clickUp,
  type,

  // Keyboard
  typeText,
  sendTextToSelector,
  pressKey,
  clearInput,

  // Cookie
  getCookies,
  setCookies,
  clearCookies,

  // Logic
  ifCondition,
  loopFor,
  loopElements,
  evalJs,

  // Data & Utilities
  setVariable,
  readCsv,
  writeCsv,
  downloadFile,
  screenshot,
  log,
  delay,

  // Phase 5: Data Extraction & DOM Inspection
  getText,
  getAttributeValue,
  getValue,
  elementExists,
  extractionInText,
  random,

  // Phase 6: Network & Advanced
  http,
  setUserAgent,
  getUrl,
  convertingJson,
  imageSearch,

  // Phase 7: Logic & Flow Control
  while: whileLoop,
  stopLoop,
  runOtherScript,
  addLog,
  addComment,

  // Extension (spike)
  switchExtensionPopup,
};

export const NODE_TYPES = Object.keys(handlers);

export function getHandler(nodeType) {
  return Object.prototype.hasOwnProperty.call(handlers, nodeType)
    ? handlers[nodeType]
    : null;
}
