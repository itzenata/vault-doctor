import type { Plugin } from "obsidian";

// Actions entry point. Implementation lands in the parallel sub-task:
// dispatcher for archive / delete / whitelist / open / fix, with safety
// confirmations and (eventual) backup hooks.
//
// Public contract used by main.ts:
//   registerActions(plugin) — wires the action dispatcher onto the plugin
export async function registerActions(plugin: Plugin): Promise<void> {
  void plugin;
}
