import type { Plugin } from "obsidian";

// Settings entry point. Implementation lands in the parallel sub-task:
// VaultDoctorSettings interface, defaults, persistence, SettingsTab UI.
//
// Public contract used by main.ts:
//   registerSettings(plugin) — loads persisted settings, registers the tab
export async function registerSettings(plugin: Plugin): Promise<void> {
  void plugin;
}
