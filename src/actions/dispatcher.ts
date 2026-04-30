// Vault Doctor — action dispatcher.
//
// Single entry point that the UI calls when a button is clicked. The
// dispatcher:
//   1. Normalises a single Issue or batch into an array.
//   2. Asks `requiresConfirmation` whether to prompt; runs the modal if so.
//   3. Applies the matching handler to each issue, catching per-item errors
//      so one bad note never aborts the whole batch.
//   4. Returns a structured ActionResult for the caller to surface as a
//      Notice or richer UI.
//
// Errors are *aggregated*, never thrown — except for genuinely programmer
// errors like asking for the unimplemented "fix" action.

import type { Plugin } from "obsidian";
import type { ActionId, Issue } from "../types";
import { confirmAction } from "./confirmation";
import { archive, openNote, trashFile, whitelist } from "./handlers";
import { requiresConfirmation } from "./policy";

export interface ActionResult {
  applied: number;
  skipped: number;
  errors: { issue: Issue; error: string }[];
}

/**
 * Execute `actionId` against one or many `Issue`s. The contract is:
 *   - never throws for per-issue failures (collected in `errors`)
 *   - throws synchronously for unsupported actions ("fix")
 *   - returns immediately with all-skipped result when the user cancels
 *     the confirmation modal
 */
export async function executeAction(
  plugin: Plugin,
  actionId: ActionId,
  scope: Issue | Issue[],
): Promise<ActionResult> {
  if (actionId === "fix") {
    throw new Error("fix action not yet supported");
  }

  const issues = Array.isArray(scope) ? scope : [scope];

  if (issues.length === 0) {
    return { applied: 0, skipped: 0, errors: [] };
  }

  if (requiresConfirmation(actionId, issues.length)) {
    const proceed = await confirmAction(plugin.app, {
      title: confirmationTitle(actionId, issues.length),
      body: confirmationBody(actionId, issues),
      destructive: actionId === "delete",
    });
    if (!proceed) {
      return { applied: 0, skipped: issues.length, errors: [] };
    }
  }

  const result: ActionResult = { applied: 0, skipped: 0, errors: [] };

  for (const issue of issues) {
    try {
      await runHandler(plugin, actionId, issue);
      result.applied += 1;
    } catch (err) {
      result.errors.push({ issue, error: errorMessage(err) });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

async function runHandler(
  plugin: Plugin,
  actionId: ActionId,
  issue: Issue,
): Promise<void> {
  switch (actionId) {
    case "archive":
      await archive(plugin, issue);
      return;
    case "delete":
      await trashFile(plugin, issue);
      return;
    case "whitelist":
      await whitelist(plugin, issue);
      return;
    case "open":
      await openNote(plugin, issue);
      return;
    case "fix":
      // Guard repeated for exhaustiveness; the early return in executeAction
      // handles the user-facing case before we get here.
      throw new Error("fix action not yet supported");
  }
}

function confirmationTitle(actionId: ActionId, count: number): string {
  switch (actionId) {
    case "delete":
      return count === 1 ? "Delete note?" : `Delete ${count} notes?`;
    case "archive":
      return `Archive ${count} notes?`;
    default:
      return "Confirm action";
  }
}

function confirmationBody(actionId: ActionId, issues: Issue[]): string {
  const count = issues.length;
  switch (actionId) {
    case "delete":
      return count === 1
        ? `"${issues[0].notePath}" will be moved to your system trash.`
        : `${count} notes will be moved to your system trash. This is reversible from your OS file manager until trash is emptied.`;
    case "archive":
      return `${count} notes will be moved into the _archive/ folder. You can move them back manually at any time.`;
    default:
      return `Apply "${actionId}" to ${count} ${count === 1 ? "issue" : "issues"}?`;
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
