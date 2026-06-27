// URL scheme allowlist — red-team #10.
// A .donutflow is untrusted: it runs against a profile context that is already
// logged in (cookies/sessions/passwords). Navigation nodes must NOT be allowed
// to reach local resources or execute script via the URL. Default allow only
// http/https; anything else (file:, chrome:, javascript:, data:, blob:, about:,
// ftp:, etc.) is rejected unless the flow explicitly opts a scheme in.

const DEFAULT_ALLOWED_SCHEMES = ["http:", "https:"];

/**
 * Validate a navigation URL against the scheme allowlist.
 * @param {string} rawUrl - the (already variable-interpolated) URL string
 * @param {string[]} [allowedSchemes] - optional override list, e.g. ["http:","https:","ftp:"]
 * @returns {URL} the parsed URL when allowed
 * @throws {Error} when the URL is unparseable or its scheme is not allowed
 */
export function assertNavigableUrl(rawUrl, allowedSchemes = DEFAULT_ALLOWED_SCHEMES) {
  if (typeof rawUrl !== "string" || rawUrl.trim() === "") {
    throw new Error("openUrl: url must be a non-empty string");
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`openUrl: invalid URL: ${rawUrl}`);
  }

  // Normalize allowlist to lowercase scheme-with-colon form.
  const allow = allowedSchemes.map((s) =>
    s.endsWith(":") ? s.toLowerCase() : `${s.toLowerCase()}:`,
  );

  if (!allow.includes(parsed.protocol.toLowerCase())) {
    throw new Error(
      `openUrl: scheme "${parsed.protocol}" is not allowed (allowed: ${allow.join(", ")}). ` +
        `Rejecting potentially dangerous navigation target.`,
    );
  }

  return parsed;
}

/**
 * Non-throwing scheme check for static validation (validate.mjs uses this to
 * reject obviously-hostile literal URLs before runtime). Returns false for
 * unparseable URLs or disallowed schemes.
 * @param {string} rawUrl
 * @param {string[]} [allowedSchemes]
 * @returns {boolean}
 */
export function isAllowedUrlScheme(rawUrl, allowedSchemes = DEFAULT_ALLOWED_SCHEMES) {
  try {
    assertNavigableUrl(rawUrl, allowedSchemes);
    return true;
  } catch {
    return false;
  }
}

export { DEFAULT_ALLOWED_SCHEMES };
