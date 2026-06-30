// Profile flow nodes — openProfile / closeProfile via local automation engine host.
// Browser lifecycle is owned by the Rust orchestrator; handlers call 127.0.0.1 only.

function engineBaseUrl() {
  const raw = process.env.AUTOMATION_ENGINE_HOST;
  if (!raw || typeof raw !== "string" || raw.trim() === "") {
    throw new Error(
      "openProfile/closeProfile: AUTOMATION_ENGINE_HOST is not set (automation engine host not running)",
    );
  }
  return raw.replace(/\/$/, "");
}

async function postJson(path, body) {
  const url = `${engineBaseUrl()}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${path}: invalid JSON response (${res.status})`);
  }
  if (!res.ok) {
    const msg = typeof data.error === "string" ? data.error : text || res.statusText;
    throw new Error(`${path} failed: ${msg}`);
  }
  return data;
}

function applyOpenProfileVars(ctx, profileId, result) {
  ctx.vars.PROFILE_ID = profileId;
  if (result.cdpPort != null) {
    ctx.vars.CDP_PORT = String(result.cdpPort);
  }
  if (result.proxyIp != null && result.proxyIp !== "") {
    ctx.vars.PROXY_IP = String(result.proxyIp);
  }
  if (result.ipCountry != null && result.ipCountry !== "") {
    ctx.vars.IP_COUNTRY = String(result.ipCountry);
  }
  if (result.browserPid != null) {
    ctx.vars.BROWSER_PID = String(result.browserPid);
  }
}

/** openProfile: proxy/IP/webhooks; reuses run CDP when profile matches orchestrator target. */
export async function openProfile(node, _page, ctx) {
  const { profileId, automation } = node.params ?? {};
  if (typeof profileId !== "string" || profileId.trim() === "") {
    throw new Error("openProfile: profileId is required");
  }

  const runProfileId = process.env.AUTOMATION_RUN_PROFILE_ID;
  const cdpPortRaw = process.env.AUTOMATION_RUN_CDP_PORT;
  const cdpPort =
    cdpPortRaw != null && cdpPortRaw !== "" ? Number.parseInt(String(cdpPortRaw), 10) : undefined;

  let automationConfig;
  if (typeof automation === "string" && automation.trim() !== "") {
    try {
      automationConfig = JSON.parse(automation);
    } catch (e) {
      throw new Error(`openProfile: automation is not valid JSON — ${e.message}`);
    }
  }

  const body = {
    profileId: profileId.trim(),
    automation: automationConfig ?? null,
    runProfileId: runProfileId ?? null,
    cdpPort: Number.isFinite(cdpPort) ? cdpPort : null,
  };

  ctx.logger.info(node.id, `openProfile → ${body.profileId}`);
  const result = await postJson("/open-profile", body);
  applyOpenProfileVars(ctx, body.profileId, result);
  ctx.logger.info(
    node.id,
    `openProfile ✓ CDP_PORT=${ctx.vars.CDP_PORT ?? "?"} PROXY_IP=${ctx.vars.PROXY_IP ?? "-"}`,
  );
}

/** closeProfile: close browser + optional cleanup (does not spawn browser). */
export async function closeProfile(node, _page, ctx) {
  const { profileId, cleanupMode } = node.params ?? {};
  if (typeof profileId !== "string" || profileId.trim() === "") {
    throw new Error("closeProfile: profileId is required");
  }
  const mode = typeof cleanupMode === "string" && cleanupMode.trim() !== "" ? cleanupMode : "cookies";

  ctx.logger.info(node.id, `closeProfile → ${profileId.trim()} (${mode})`);
  await postJson("/close-profile", {
    profileId: profileId.trim(),
    cleanupMode: mode,
  });
  ctx.logger.info(node.id, "closeProfile ✓");
}