// Vault Doctor — STALE-NOTE rule.
// Emits one info issue per note whose mtime is older than one year, after
// excluding folders that are intentionally written-once (archives, dailies).

import type { Issue, Rule, ScanContext } from "../types";

// Path fragments (case-insensitive) that exclude a note from the stale check.
// Daily notes are written once and rarely revisited; archives are by design
// frozen historical material.
const PATH_EXCLUSIONS: readonly string[] = [
  "_archive/",
  "daily/",
  "daily notes/",
];

// One year in milliseconds — the freshness window beyond which a note is
// considered stale.
const STALE_AGE_MS = 365 * 24 * 60 * 60 * 1000;

// Approximate month length in milliseconds, used only for the human-readable
// message ("Untouched for N months").
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

export const STALE_NOTE_RULE: Rule = {
  id: "STALE-NOTE",
  name: "Stale note",
  severity: "info",
  category: "Activité",
  description: "Note untouched for over 12 months",
  weight: 3,
  evaluate(ctx: ScanContext): Issue[] {
    const issues: Issue[] = [];
    const now = Date.now();
    for (const note of ctx.vault.notes.values()) {
      const age = now - note.mtime;
      if (age <= STALE_AGE_MS) continue;

      const lowerPath = note.path.toLowerCase();
      let excludedByPath = false;
      for (const fragment of PATH_EXCLUSIONS) {
        if (lowerPath.includes(fragment)) {
          excludedByPath = true;
          break;
        }
      }
      if (excludedByPath) continue;

      const approxMonths = Math.floor(age / MONTH_MS);
      issues.push({
        ruleId: STALE_NOTE_RULE.id,
        severity: STALE_NOTE_RULE.severity,
        notePath: note.path,
        message: `Untouched for ${approxMonths} months`,
        suggestedAction: "archive",
      });
    }
    return issues;
  },
};
