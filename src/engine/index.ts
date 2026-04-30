import type { Plugin } from "obsidian";

// Scan engine entry point. The engine implementation will be added by the
// engine sub-task: file walker, index builder, link resolver, rule registry.
//
// Public contract used by main.ts:
//   registerEngine(plugin) — wires commands and lifecycle hooks
export async function registerEngine(plugin: Plugin): Promise<void> {
  void plugin;
}
