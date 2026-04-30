import type { Plugin } from "obsidian";

// Status-bar entry point. Implementation lands in the parallel sub-task:
// shows current vault score in Obsidian's bottom status bar, click opens
// the dashboard, updates on the workspace event "vault-doctor:scan-complete".
//
// Public contract used by main.ts:
//   registerStatusBar(plugin) — adds the status-bar item and its listeners
export async function registerStatusBar(plugin: Plugin): Promise<void> {
  void plugin;
}
