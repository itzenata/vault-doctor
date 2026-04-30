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

import type { Plugin } from "obsidian";
import type { ActionId, Issue } from "../types";
import { executeAction, type ActionResult } from "./dispatcher";

export { executeAction } from "./dispatcher";
export type { ActionResult } from "./dispatcher";
export { requiresConfirmation } from "./policy";
export { confirmAction } from "./confirmation";
export { fixBrokenLink } from "./fixBrokenLink";
export type { FixOutcome } from "./fixBrokenLink";

/**
 * Plugin instances augmented with the action dispatcher. We keep the surface
 * narrow (`execute`) so adding helpers later doesn't ripple through callers.
 */
export interface VaultDoctorPluginWithActions extends Plugin {
  actions: {
    execute: (
      actionId: ActionId,
      scope: Issue | Issue[],
    ) => Promise<ActionResult>;
  };
}

/**
 * Attach an `actions.execute` helper bound to this plugin instance. The UI
 * layer reads it via `(plugin as VaultDoctorPluginWithActions).actions`.
 */
export async function registerActions(plugin: Plugin): Promise<void> {
  (plugin as VaultDoctorPluginWithActions).actions = {
    execute: (actionId, scope) => executeAction(plugin, actionId, scope),
  };
}
