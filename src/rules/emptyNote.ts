// Vault Doctor — EMPTY-NOTE rule.
// Emits one warning per note whose body (content excluding YAML frontmatter)
// is below a small character threshold.

import type { Issue, Rule, ScanContext } from "../types";

// Path fragments (case-insensitive) that exclude a note from the empty check.
// Mirrors the orphan-note exclusions for the MVP — templates and archives are
// expected to be sparse.
const PATH_EXCLUSIONS: readonly string[] = ["templates/", "_archive/"];

// PRD §5.1.A5: "< 50 characters or no content other than frontmatter".
const BODY_LENGTH_THRESHOLD = 50;

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
      if (note.bodyLength >= BODY_LENGTH_THRESHOLD) continue;

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
        message: `Empty or near-empty note (${note.bodyLength} chars)`,
        suggestedAction: "archive",
      });
    }
    return issues;
  },
};
