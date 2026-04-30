// Vault Doctor — settings entry point.
//
// `registerSettings(plugin)` is the only public surface main.ts depends on.
// It:
//   1. constructs a SettingsStore and hydrates it from disk
//   2. attaches the store to the plugin (mirrors VaultDoctorPluginWithEngine)
//   3. registers the SettingsTab so users can edit settings in Obsidian
//
// Downstream modules (engine, actions, statusbar, UI) should reach for
// `(plugin as VaultDoctorPluginWithSettings).settings.values` rather than
// importing DEFAULT_SETTINGS directly — that's the live, persisted state.

import type { Plugin } from "obsidian";
import { SettingsStore } from "./store";
import { SettingsTab } from "./SettingsTab";

export { SettingsStore } from "./store";
export { SettingsTab } from "./SettingsTab";
export {
  DEFAULT_SETTINGS,
  PROFILE_PRESETS,
  type Profile,
  type ScanTrigger,
  type VaultDoctorSettings,
} from "./types";

/**
 * Plugin instances augmented by the settings module carry a `settings` field.
 * Structural type — keeps main.ts free of cross-module imports, same trick
 * the engine uses with `VaultDoctorPluginWithEngine`.
 */
export interface VaultDoctorPluginWithSettings extends Plugin {
  settings: SettingsStore;
}

export async function registerSettings(plugin: Plugin): Promise<void> {
  const store = new SettingsStore(plugin);
  await store.load();
  (plugin as VaultDoctorPluginWithSettings).settings = store;

  plugin.addSettingTab(new SettingsTab(plugin.app, plugin, store));
}
