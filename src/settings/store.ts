// Vault Doctor — settings store.
//
// Thin in-memory + persisted wrapper around Obsidian's plugin data API.
// Mirrors the engine's pattern: a single instance lives on the plugin, every
// consumer reads from `store.values` and mutates via `store.update(...)`.

import type { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, type VaultDoctorSettings } from "./types";

export class SettingsStore {
  private state: VaultDoctorSettings;

  constructor(private readonly plugin: Plugin) {
    // Cloned so consumers cannot accidentally mutate the shared default object.
    this.state = cloneSettings(DEFAULT_SETTINGS);
  }

  /** Hydrate from disk, merging on top of defaults so new keys land safely. */
  async load(): Promise<void> {
    const raw = (await this.plugin.loadData()) as Partial<VaultDoctorSettings> | null;
    this.state = mergeSettings(DEFAULT_SETTINGS, raw ?? {});
  }

  /** Persist current state to disk. */
  async save(): Promise<void> {
    await this.plugin.saveData(this.state);
  }

  /** Read-only snapshot. Callers should not mutate it; use `update` instead. */
  get values(): VaultDoctorSettings {
    return this.state;
  }

  /** Set a single key and persist atomically. */
  async update<K extends keyof VaultDoctorSettings>(
    key: K,
    value: VaultDoctorSettings[K],
  ): Promise<void> {
    this.state = { ...this.state, [key]: value };
    await this.save();
  }

  /** Apply a partial patch and persist. Useful for profile presets. */
  async patch(partial: Partial<VaultDoctorSettings>): Promise<void> {
    this.state = { ...this.state, ...partial };
    await this.save();
  }
}

function cloneSettings(s: VaultDoctorSettings): VaultDoctorSettings {
  return {
    ...s,
    enabledRules: { ...s.enabledRules },
    excludedFolders: [...s.excludedFolders],
    excludedTags: [...s.excludedTags],
  };
}

/**
 * Shallow merge with a deep-merge for the nested `enabledRules` map so that a
 * persisted file missing a newly-added rule still ends up with that rule
 * enabled by default.
 */
function mergeSettings(
  base: VaultDoctorSettings,
  override: Partial<VaultDoctorSettings>,
): VaultDoctorSettings {
  return {
    ...base,
    ...override,
    enabledRules: {
      ...base.enabledRules,
      ...(override.enabledRules ?? {}),
    },
    excludedFolders: override.excludedFolders
      ? [...override.excludedFolders]
      : [...base.excludedFolders],
    excludedTags: override.excludedTags
      ? [...override.excludedTags]
      : [...base.excludedTags],
  };
}
