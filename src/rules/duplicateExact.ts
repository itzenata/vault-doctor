// Vault Doctor — DUPLICATE-EXACT rule.
// Two notes are flagged as duplicates when they share an identical content
// hash AND the same body length (length is a cheap second key that prevents
// any 32-bit FNV-1a collision from producing a false positive). Empty notes
// are skipped — EMPTY-NOTE handles those.

import type { Issue, NoteMeta, Rule, ScanContext } from "../types";

const MIN_BODY_LENGTH = 20;

// Path fragments excluded from duplicate detection. An archived note that
// happens to share content with a live one is intentional history, not a
// "duplicate" the user needs to clean up.
const PATH_EXCLUSIONS: readonly string[] = ["_archive/"];

function isPathExcluded(path: string): boolean {
  const lower = path.toLowerCase();
  for (const fragment of PATH_EXCLUSIONS) {
    if (lower.includes(fragment)) return true;
  }
  return false;
}

export const DUPLICATE_EXACT_RULE: Rule = {
  id: "DUPLICATE-EXACT",
  name: "Duplicate note",
  severity: "critical",
  category: "Doublons",
  description:
    "Two or more notes share identical content — likely accidental duplicates",
  weight: 9,
  evaluate(ctx: ScanContext): Issue[] {
    const groups = new Map<string, NoteMeta[]>();

    for (const note of ctx.vault.notes.values()) {
      if (note.contentHash === undefined) continue;
      if (note.bodyLength < MIN_BODY_LENGTH) continue;
      if (isPathExcluded(note.path)) continue;

      const key = `${note.bodyLength}:${note.contentHash}`;
      const list = groups.get(key);
      if (list === undefined) groups.set(key, [note]);
      else list.push(note);
    }

    const issues: Issue[] = [];

    for (const list of groups.values()) {
      if (list.length < 2) continue;

      // Canonical pick: the oldest note (lowest mtime) is treated as the
      // original. Rationale: Obsidian's "Save copy" flow stamps the copy's
      // mtime to "now" while leaving the original's mtime untouched — so
      // mtime reliably identifies the user's "intended" file. Path order
      // would invert that here: "Recipe (1).md" sorts BEFORE "Recipe.md"
      // (because '(' < '.'), and we'd recommend deleting the original. Path
      // is kept only as a deterministic tiebreaker for synthetic cases where
      // both files share the exact same mtime.
      list.sort((a, b) => {
        if (a.mtime !== b.mtime) return a.mtime - b.mtime;
        return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
      });
      const canonical = list[0];

      for (let i = 1; i < list.length; i++) {
        const dup = list[i];
        issues.push({
          ruleId: DUPLICATE_EXACT_RULE.id,
          severity: DUPLICATE_EXACT_RULE.severity,
          notePath: dup.path,
          message: `Duplicate of ${canonical.path}`,
          context: {
            targetPath: canonical.path,
          },
          suggestedAction: "delete",
        });
      }
    }

    return issues;
  },
};
