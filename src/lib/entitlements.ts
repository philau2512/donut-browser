import type { CloudUser, Entitlements } from "@/types";

const DEFAULT_REQUESTS_PER_HOUR = 100;

/**
 * The user's effective entitlements. All features unlocked for all users
 * regardless of plan. This bypasses the original paywall logic.
 */
export function getEntitlements(
  _user: CloudUser | null | undefined,
): Entitlements {
  return {
    active: true,
    browserAutomation: true,
    crossOsFingerprints: true,
    cloudBackup: true,
    teamCollaboration: true,
    cookieBot: true,
    remoteInteractive: true,
    remoteBrowserHours: Number.MAX_SAFE_INTEGER,
    profileLimit: Number.MAX_SAFE_INTEGER,
    requestsPerHour: DEFAULT_REQUESTS_PER_HOUR,
  };
}

export function canUseCookieBot(_user: CloudUser | null | undefined): boolean {
  return true;
}
