// Vault Doctor — actions entry point.
//
// Registers the action dispatcher onto the plugin instance so other layers
// (UI, command palette) can reach it without re-importing the dispatcher
// directly. The structural type `VaultDoctorPluginWithActions` mirrors the
// pattern used by the engine (./engine).
//
// Public surface:
//   - registerActions(plugin)              — wires `.actions` onto the plugin
//   - executeAction(plugin, id, scope)     — direct call from any caller
//   - ActionResult                          — return shape from executeAction
//   - VaultDoctorPluginWithActions          — structural type for callers
//                                             that need typed access to
//                                             plugin.actions.execute
//
// Safety: the dispatcher applies confirmation policy per PRD §9. Callers
// don't need to gate destructive actions themselves.

import { Notice, type Plugin } from "obsidian";
import type { ActionId, Issue } from "../types";
import { executeAction, type ActionResult } from "./dispatcher";
import { createUndoManager, type UndoManager } from "./undo";

export { executeAction } from "./dispatcher";
export type { ActionResult } from "./dispatcher";
export { requiresConfirmation } from "./policy";
export { confirmAction } from "./confirmation";
export { fixBrokenLink } from "./fixBrokenLink";
export type { FixOutcome } from "./fixBrokenLink";
export {
  listBackups,
  readBackupManifest,
  restoreBackup,
} from "./backup";
export type { BackupManifest, BackupManifestEntry } from "./backup";

/**
 * Plugin instances augmented with the action dispatcher AND the undo
 * manager. We keep the surface narrow so adding helpers later doesn't
 * ripple through callers.
 */
export interface VaultDoctorPluginWithActions extends Plugin {
  actions: {
    execute: (
      actionId: ActionId,
      scope: Issue | Issue[],
    ) => Promise<ActionResult>;
    undo: UndoManager;
  };
}

/**
 * Attach `actions.execute` and `actions.undo` to the plugin instance. The
 * dispatcher records every destructive batch's backup manifest into the
 * undo manager so a single command can roll the last operation back.
 *
 * Also registers the `vault-doctor:undo-last` command — this is the user's
 * only entry point to undo today; UI buttons would be a v1.1+ polish.
 */
export async function registerActions(plugin: Plugin): Promise<void> {
  const undo = await createUndoManager(plugin);

  (plugin as VaultDoctorPluginWithActions).actions = {
    execute: async (actionId, scope) => {
      const result = await executeAction(plugin, actionId, scope);
      if (result.backup !== undefined) undo.record(result.backup);
      return result;
    },
    undo,
  };

  plugin.addCommand({
    id: "vault-doctor:undo-last",
    name: "Vault Doctor: Undo last destructive action",
    callback: async () => {
      const head = undo.peek();
      if (head === null) {
        new Notice("Nothing to undo");
        return;
      }
      const restored = await undo.undoLast();
      if (restored === 0) {
        new Notice(
          "Undo found no files to restore (already in place or backup missing)",
        );
        return;
      }
      new Notice(
        `Restored ${restored} ${restored === 1 ? "file" : "files"} from ${head.timestamp}`,
      );
      // Re-run the scan so the dashboard / status bar reflect the restored
      // vault state. The scanner is attached by `registerEngine` (load order
      // in main.ts puts engine first), but we tolerate its absence in case a
      // future refactor changes that ordering.
      const pluginWithScanner = plugin as Plugin & {
        scanner?: { scan: () => Promise<unknown> };
      };
      if (pluginWithScanner.scanner !== undefined) {
        void pluginWithScanner.scanner.scan();
      }
    },
  });
}
