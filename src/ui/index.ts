import type { Plugin } from "obsidian";

// Dashboard UI entry point. The implementation will be added by the UI
// sub-task: ItemView with score gauge, severity rows, action buttons.
//
// Public contract used by main.ts:
//   registerUI(plugin) — registers the view type, ribbon icon, and commands
export async function registerUI(plugin: Plugin): Promise<void> {
  void plugin;
}
