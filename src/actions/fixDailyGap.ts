// Vault Doctor — fix-daily-gap action.
//
// Creates the missing daily note at the same folder as the bracketing daily
// note the rule reported. The DAILY-GAP rule sets:
//   - issue.notePath        → the *later* of the two bracketing daily notes
//   - issue.context.targetPath → the missing ISO date (YYYY-MM-DD)
//
// We don't read the user's daily-notes plugin settings (template path,
// custom format) — minimum viable fix is a one-line `# YYYY-MM-DD`
// markdown file in the same folder as a known existing daily. Users with
// rich daily-note templates can still use this fix and edit afterwards.

import { type Plugin, TFile } from "obsidian";
import type { Issue } from "../types";
import type { FixOutcome } from "./fixBrokenLink";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function fixDailyGap(
  plugin: Plugin,
  issue: Issue,
): Promise<FixOutcome> {
  const isoDate = issue.context?.targetPath;
  if (isoDate === undefined || !ISO_DATE_RE.test(isoDate)) {
    return {
      applied: false,
      skipped: false,
      error: "Issue has no valid ISO date in context.targetPath",
    };
  }

  // Locate the bracketing daily note's folder. It's the parent dir of
  // `issue.notePath` — the rule guarantees this is a real daily file.
  const bracketingAbs = plugin.app.vault.getAbstractFileByPath(issue.notePath);
  if (!(bracketingAbs instanceof TFile)) {
    return {
      applied: false,
      skipped: false,
      error: `Bracketing daily note not found: ${issue.notePath}`,
    };
  }

  const folder = bracketingAbs.parent?.path ?? "";
  const newPath =
    folder === "" || folder === "/" ? `${isoDate}.md` : `${folder}/${isoDate}.md`;

  // If the user (or a previous attempt) already created the note, skip
  // rather than overwrite — we don't want to clobber the user's content.
  const existing = plugin.app.vault.getAbstractFileByPath(newPath);
  if (existing !== null) {
    return {
      applied: false,
      skipped: true,
    };
  }

  const body = `# ${isoDate}\n`;
  try {
    await plugin.app.vault.create(newPath, body);
  } catch (err) {
    return {
      applied: false,
      skipped: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return { applied: true, skipped: false };
}
