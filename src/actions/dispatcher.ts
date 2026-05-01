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
// Errors are *aggregated*, never thrown.

import type { Plugin } from "obsidian";
import type { ActionId, Issue } from "../types";
import { type BackupManifest, snapshotIssues } from "./backup";
import { confirmAction } from "./confirmation";
import { fixBrokenLink } from "./fixBrokenLink";
import { archive, openNote, trashFile, whitelist } from "./handlers";
import { requiresConfirmation } from "./policy";
import { fixDailyGap } from "./fixDailyGap";
import { fixTagInconsistent } from "./fixTagInconsistent";
import { removeBrokenLink } from "./removeBrokenLink";

export interface ActionResult {
  applied: number;
  skipped: number;
  errors: { issue: Issue; error: string }[];
  /**
   * Backup manifest written before this batch ran, when the action was
   * destructive AND `settings.autoBackup` is on. Surfaces to the UI so it
   * can offer a one-click undo Notice.
   */
  backup?: BackupManifest;
}

/**
 * Execute `actionId` against one or many `Issue`s. The contract is:
 *   - never throws for per-issue failures (collected in `errors`)
 *   - returns immediately with all-skipped result when the user cancels
 *     the confirmation modal
 */
export async function executeAction(
  plugin: Plugin,
  actionId: ActionId,
  scope: Issue | Issue[],
): Promise<ActionResult> {
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

  if (actionId === "fix") {
    // Fix is interactive — one modal/operation per issue. Dispatch by ruleId
    // since the "fix" semantics differ:
    //   BROKEN-LINK / BROKEN-EMBED → SuggestModal to pick a replacement
    //   TAG-INCONSISTENT → in-place rewrite to the canonical tag (no modal)
    // Bulk batches are confirmed once at the top; per-issue cancels
    // (e.g. closing the SuggestModal) count as `skipped`.
    for (const issue of issues) {
      try {
        const r = await runFixForRule(plugin, issue);
        if (r === null) {
          result.errors.push({
            issue,
            error: `Fix not supported for rule ${issue.ruleId}`,
          });
          continue;
        }
        if (r.applied) result.applied += 1;
        else if (r.skipped) result.skipped += 1;
        if (r.error !== undefined) {
          result.errors.push({ issue, error: r.error });
        }
      } catch (err) {
        result.errors.push({ issue, error: errorMessage(err) });
      }
    }
    return result;
  }

  // Snapshot before any destructive op so the user can recover from a
  // mistake. `snapshotIssues` is a no-op for non-destructive actions and
  // when `settings.autoBackup` is off — it returns null in either case.
  const backup = await snapshotIssues(plugin, actionId, issues);
  if (backup !== null) result.backup = backup;

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

/**
 * Resolve the "fix" semantics for a given issue's rule. Returns null when no
 * fix path is wired for that rule — the dispatcher surfaces that as a
 * non-fatal error against the issue.
 */
async function runFixForRule(
  plugin: Plugin,
  issue: Issue,
): Promise<{ applied: boolean; skipped: boolean; error?: string } | null> {
  switch (issue.ruleId) {
    case "BROKEN-LINK":
    case "BROKEN-EMBED":
      return fixBrokenLink(plugin, issue);
    case "TAG-INCONSISTENT":
      return fixTagInconsistent(plugin, issue);
    case "DAILY-GAP":
      return fixDailyGap(plugin, issue);
    default:
      return null;
  }
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
    case "remove": {
      // Non-interactive companion to fix: drop the broken link entirely
      // rather than picking a replacement. Available only for BROKEN-LINK
      // and BROKEN-EMBED — other rules have no analogue.
      if (
        issue.ruleId !== "BROKEN-LINK" &&
        issue.ruleId !== "BROKEN-EMBED"
      ) {
        throw new Error(`Remove not supported for rule ${issue.ruleId}`);
      }
      const r = await removeBrokenLink(plugin, issue);
      if (r.error !== undefined) throw new Error(r.error);
      if (!r.applied) throw new Error("Remove did not apply");
      return;
    }
    case "fix":
      // Handled inline in executeAction (interactive flow); we should never
      // reach the generic handler dispatch with actionId === "fix".
      throw new Error("fix action handled inline; runHandler not applicable");
  }
}

function confirmationTitle(actionId: ActionId, count: number): string {
  switch (actionId) {
    case "delete":
      return count === 1 ? "Delete note?" : `Delete ${count} notes?`;
    case "archive":
      return `Archive ${count} notes?`;
    case "fix":
      return `Fix ${count} broken links?`;
    case "remove":
      return `Remove ${count} broken references?`;
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
    case "fix":
      return `You'll be asked to pick a replacement target for each of ${count} broken links, one at a time. Cancel any modal to skip that issue.`;
    case "remove":
      return `${count} broken references will be deleted from their source notes. Aliases (like \`[[Ghost|Click here]]\`) are kept as plain text; bare wikilinks and embeds are dropped entirely.`;
    default:
      return `Apply "${actionId}" to ${count} ${count === 1 ? "issue" : "issues"}?`;
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
