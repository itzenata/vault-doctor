// Vault Doctor — OVERSIZED-NOTE rule.
// Emits one info issue per note whose body length is far above the typical
// word count, suggesting the user consider splitting it into smaller notes.

import type { Issue, Rule, ScanContext } from "../types";

// Path fragments (case-insensitive) that exclude a note from the oversized
// check. Archived notes are intentionally large historical dumps.
const PATH_EXCLUSIONS: readonly string[] = ["_archive/"];

// PRD threshold: notes above 50,000 words are flagged for splitting.
const WORDS_THRESHOLD = 50000;

// Heuristic conversion from `bodyLength` (characters) to an approximate
// word count. English averages ~5 chars/word including spacing.
const CHARS_PER_WORD = 5;

const BODY_LENGTH_THRESHOLD = WORDS_THRESHOLD * CHARS_PER_WORD;

export const OVERSIZED_NOTE_RULE: Rule = {
  id: "OVERSIZED-NOTE",
  name: "Oversized note",
  severity: "info",
  category: "Contenu",
  description:
    "Note far above the typical word count — consider splitting",
  weight: 2,
  evaluate(ctx: ScanContext): Issue[] {
    const issues: Issue[] = [];
    for (const note of ctx.vault.notes.values()) {
      if (note.bodyLength <= BODY_LENGTH_THRESHOLD) continue;

      const lowerPath = note.path.toLowerCase();
      let excludedByPath = false;
      for (const fragment of PATH_EXCLUSIONS) {
        if (lowerPath.includes(fragment)) {
          excludedByPath = true;
          break;
        }
      }
      if (excludedByPath) continue;

      const approxWords = Math.round(note.bodyLength / CHARS_PER_WORD);
      issues.push({
        ruleId: OVERSIZED_NOTE_RULE.id,
        severity: OVERSIZED_NOTE_RULE.severity,
        notePath: note.path,
        message: `Oversized note (${approxWords} words)`,
        suggestedAction: "open",
      });
    }
    return issues;
  },
};
