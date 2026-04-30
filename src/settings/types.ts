// Vault Doctor — settings type contracts.
//
// These types define the persisted plugin settings. They are consumed by the
// SettingsStore for serialization and by the SettingsTab for UI rendering.
// Future commits will wire the engine to read excludedFolders / excludedTags /
// enabledRules when running scans.

import { ALL_RULES } from "../rules";

export type Profile = "strict" | "standard" | "indulgent";

export type ScanTrigger = "manual" | "open" | "daily" | "weekly";

export interface VaultDoctorSettings {
  /** Currently selected profile preset. Drives default thresholds. */
  profile: Profile;
  /** Per-rule enable map, keyed by rule id (e.g. "BROKEN-LINK"). */
  enabledRules: Record<string, boolean>;
  /** Folder path prefixes excluded from scans, e.g. "templates/". */
  excludedFolders: string[];
  /** Tag exclusions, e.g. "#wip". Notes carrying any of these are skipped. */
  excludedTags: string[];
  /** When the scan should run automatically. */
  scanOn: ScanTrigger;
  /** When true, fix/archive/delete actions only preview by default. */
  dryRunDefault: boolean;
  /** When true, take a snapshot before destructive bulk actions. */
  autoBackup: boolean;
  /** Confirmation prompt threshold for bulk operations. */
  bulkConfirmThreshold: number;
  /**
   * Paths whitelisted by the user — never reported as issues. Markdown notes
   * normally use `vault-doctor: ignore` in frontmatter; this list is the
   * fallback for files that can't carry frontmatter (images, PDFs, etc.).
   */
  whitelistedPaths: string[];
}

/**
 * Build the default `enabledRules` map from the rule registry so adding a
 * new rule downstream doesn't silently leave it disabled.
 */
function buildDefaultEnabledRules(): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const rule of ALL_RULES) {
    map[rule.id] = true;
  }
  return map;
}

export const DEFAULT_SETTINGS: VaultDoctorSettings = {
  profile: "standard",
  enabledRules: buildDefaultEnabledRules(),
  excludedFolders: [],
  excludedTags: [],
  scanOn: "open",
  dryRunDefault: true,
  autoBackup: true,
  bulkConfirmThreshold: 5,
  whitelistedPaths: [],
};

/**
 * Profile presets — for now only the bulk-confirm threshold differs. Richer
 * preset behaviour (rule weights, auto-fix policy) will be layered on later.
 */
export const PROFILE_PRESETS: Record<Profile, Pick<VaultDoctorSettings, "bulkConfirmThreshold">> = {
  strict: { bulkConfirmThreshold: 0 },
  standard: { bulkConfirmThreshold: 5 },
  indulgent: { bulkConfirmThreshold: 20 },
};
