import {
  addComment,
  addLog,
  callFunction,
  endIf,
  ignoreErrorsEnd,
  ignoreErrorsStart,
  label,
  moveToLabel,
  runOtherScript,
  stopLoop,
  whileLoop,
} from "./control-flow.mjs";
import { clearCookies, getCookies, setCookies } from "./cookie.mjs";
import {
  delay,
  downloadFile,
  log,
  readCsv,
  screenshot,
  setVariable,
  writeCsv,
} from "./data.mjs";
import { switchExtensionPopup } from "./extension.mjs";
import {
  elementExists,
  extractionInText,
  getAttributeValue,
  getText,
  getValue,
  random,
} from "./extraction.mjs";
import {
  click,
  clickDown,
  clickUp,
  dragAndDrop,
  hover,
  moveAndClick,
  type,
} from "./interaction.mjs";
import {
  clearInput,
  pressKey,
  sendTextToSelector,
  typeText,
} from "./keyboard.mjs";
import { evalJs, ifCondition, loopElements, loopFor } from "./logic.mjs";
import {
  closeTab,
  goBack,
  goForward,
  newTab,
  openUrl,
  reloadPage,
  scroll,
  switchFrame,
  switchTab,
  wait,
} from "./navigator.mjs";
import {
  convertingJson,
  getUrl,
  http,
  imageSearch,
  setUserAgent,
} from "./network.mjs";
import { closeProfile, openProfile } from "./profile-flow.mjs";
import { profileFail, profileSuccess } from "./result.mjs";

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
  moveAndClick,
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
  label,
  moveToLabel,
  ignoreErrorsStart,
  ignoreErrorsEnd,
  endIf,
  callFunction,

  // Extension (spike)
  switchExtensionPopup,

  openProfile,
  closeProfile,

  // Profile Result Nodes (resource allocation plan)
  profileSuccess,
  profileFail,
};

export const NODE_TYPES = Object.keys(handlers);

export function getHandler(nodeType) {
  return Object.prototype.hasOwnProperty.call(handlers, nodeType)
    ? handlers[nodeType]
    : null;
}
