import type { BrowserProfile } from "@/types";

/** Advanced profile list filters applied from the Filter Profile modal. */
export type ProfileFilterCriteria = {
  /** One UUID per line (also accepts comma-separated). */
  uuidsText: string;
  /** One name per line (also accepts comma-separated). */
  namesText: string;
  /** When true, only running profiles pass. */
  runningOnly: boolean;
  /** Selected folder/group IDs (OR). Empty = no folder filter. */
  folderIds: string[];
  /** Selected tags (OR — profile must have at least one). Empty = no tag filter. */
  tags: string[];
  /** `__all__` | `__none__` | custom status label */
  status: string;
  /** yyyy-mm-dd local, inclusive start. Empty = no lower bound. */
  createdFrom: string;
  /** yyyy-mm-dd local, inclusive end. Empty = no upper bound. */
  createdTo: string;
};

export const EMPTY_PROFILE_FILTER: ProfileFilterCriteria = {
  uuidsText: "",
  namesText: "",
  runningOnly: false,
  folderIds: [],
  tags: [],
  status: "__all__",
  createdFrom: "",
  createdTo: "",
};

export const PROFILE_FILTER_STATUS_ALL = "__all__";
export const PROFILE_FILTER_STATUS_NONE = "__none__";

/** Split multi-line / comma-separated free text into trimmed tokens. */
export function parseFilterLines(text: string): string[] {
  return text
    .split(/[\n,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function countActiveProfileFilters(
  filter: ProfileFilterCriteria,
): number {
  let count = 0;
  if (parseFilterLines(filter.uuidsText).length > 0) count += 1;
  if (parseFilterLines(filter.namesText).length > 0) count += 1;
  if (filter.runningOnly) count += 1;
  if (filter.folderIds.length > 0) count += 1;
  if (filter.tags.length > 0) count += 1;
  if (filter.status !== PROFILE_FILTER_STATUS_ALL) count += 1;
  if (filter.createdFrom || filter.createdTo) count += 1;
  return count;
}

export function isProfileFilterActive(filter: ProfileFilterCriteria): boolean {
  return countActiveProfileFilters(filter) > 0;
}

function dayStartEpoch(dateYmd: string): number | null {
  if (!dateYmd) return null;
  const ms = new Date(`${dateYmd}T00:00:00`).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function dayEndEpoch(dateYmd: string): number | null {
  if (!dateYmd) return null;
  const ms = new Date(`${dateYmd}T23:59:59.999`).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/**
 * Apply advanced filter criteria.
 * Each non-empty criterion is AND-ed; multi-value fields inside a criterion are OR-ed.
 */
export function applyProfileFilter(
  profiles: BrowserProfile[],
  filter: ProfileFilterCriteria,
  runningProfiles: Set<string>,
): BrowserProfile[] {
  if (!isProfileFilterActive(filter)) return profiles;

  const uuids = parseFilterLines(filter.uuidsText).map((id) =>
    id.toLowerCase(),
  );
  const names = parseFilterLines(filter.namesText).map((name) =>
    name.toLowerCase(),
  );
  const folderSet = new Set(filter.folderIds);
  const tagSet = new Set(filter.tags.map((tag) => tag.toLowerCase()));
  const fromEpoch = dayStartEpoch(filter.createdFrom);
  const toEpoch = dayEndEpoch(filter.createdTo);

  return profiles.filter((profile) => {
    if (uuids.length > 0) {
      const id = profile.id.toLowerCase();
      if (!uuids.some((uuid) => id === uuid || id.includes(uuid))) {
        return false;
      }
    }

    if (names.length > 0) {
      const profileName = profile.name.toLowerCase();
      if (!names.some((name) => profileName.includes(name))) {
        return false;
      }
    }

    if (filter.runningOnly && !runningProfiles.has(profile.id)) {
      return false;
    }

    if (folderSet.size > 0) {
      if (!profile.group_id || !folderSet.has(profile.group_id)) {
        return false;
      }
    }

    if (tagSet.size > 0) {
      const profileTags = (profile.tags ?? []).map((tag) => tag.toLowerCase());
      if (!profileTags.some((tag) => tagSet.has(tag))) {
        return false;
      }
    }

    if (filter.status === PROFILE_FILTER_STATUS_NONE) {
      if (profile.profile_status) return false;
    } else if (filter.status !== PROFILE_FILTER_STATUS_ALL) {
      if (profile.profile_status !== filter.status) return false;
    }

    if (fromEpoch !== null || toEpoch !== null) {
      if (profile.created_at == null) return false;
      if (fromEpoch !== null && profile.created_at < fromEpoch) return false;
      if (toEpoch !== null && profile.created_at > toEpoch) return false;
    }

    return true;
  });
}
