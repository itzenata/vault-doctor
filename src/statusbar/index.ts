import type { EventRef, Plugin } from "obsidian";
import type { ScanResult } from "../types";
import { StatusBarItem } from "./StatusBarItem";

// Custom workspace event emitted by the scan engine. Obsidian's `Workspace.on`
// is typed via a string-union of built-in event names, so plugin-defined
// custom events need a narrow cast on both the name and the listener payload.
const SCAN_COMPLETE_EVENT = "vault-doctor:scan-complete";

type ScanCompleteOn = (
  name: typeof SCAN_COMPLETE_EVENT,
  cb: (result: ScanResult) => void,
) => EventRef;

// Status-bar entry point. Implementation lands in the parallel sub-task:
// shows current vault score in Obsidian's bottom status bar, click opens
// the dashboard, updates on the workspace event "vault-doctor:scan-complete".
//
// Public contract used by main.ts:
//   registerStatusBar(plugin) — adds the status-bar item and its listeners
export async function registerStatusBar(plugin: Plugin): Promise<void> {
  const host = plugin.addStatusBarItem();
  const item = new StatusBarItem(plugin, host);

  // Empty state until the first scan completes.
  item.update(null);

  // Workspace.on's overloads only cover built-in event names, so we cast the
  // workspace (NOT the extracted method) and call .on as a method — this
  // preserves the `this` binding Obsidian needs internally.
  type WorkspaceWithCustomOn = { on: ScanCompleteOn };
  const eventRef = (
    plugin.app.workspace as unknown as WorkspaceWithCustomOn
  ).on(SCAN_COMPLETE_EVENT, (result) => {
    item.update(result);
  });
  plugin.registerEvent(eventRef);

  // Tear down the DOM contents when the plugin unloads. Obsidian removes the
  // host element itself, but we still want our listeners detached.
  plugin.register(() => {
    item.dispose();
  });
}
