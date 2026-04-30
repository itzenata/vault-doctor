// Vault Doctor — EMPTY-NOTE rule.
// Emits one warning per note whose on-disk size is below a small threshold,
// as a cheap proxy for "no real content beyond frontmatter".

import type { Issue, Rule, ScanContext } from "../types";

// Path fragments (case-insensitive) that exclude a note from the empty check.
// Mirrors the orphan-note exclusions for the MVP — templates and archives are
// expected to be sparse.
const PATH_EXCLUSIONS: readonly string[] = ["templates/", "_archive/"];

// TODO: replace with bodyLength once Scanner exposes it
const SIZE_THRESHOLD_BYTES = 200;

export const EMPTY_NOTE_RULE: Rule = {
  id: "EMPTY-NOTE",
  name: "Empty note",
  severity: "warning",
  category: "Contenu",
  description: "Note with little or no content beyond frontmatter",
  weight: 4,
  evaluate(ctx: ScanContext): Issue[] {
    const issues: Issue[] = [];
    for (const note of ctx.vault.notes.values()) {
      // TODO: replace with bodyLength once Scanner exposes it
      if (note.size >= SIZE_THRESHOLD_BYTES) continue;

      const lowerPath = note.path.toLowerCase();
      let excludedByPath = false;
      for (const fragment of PATH_EXCLUSIONS) {
        if (lowerPath.includes(fragment)) {
          excludedByPath = true;
          break;
        }
      }
      if (excludedByPath) continue;

      issues.push({
        ruleId: EMPTY_NOTE_RULE.id,
        severity: EMPTY_NOTE_RULE.severity,
        notePath: note.path,
        message: `Empty or near-empty note (${note.size} bytes)`,
        suggestedAction: "archive",
      });
    }
    return issues;
  },
};
