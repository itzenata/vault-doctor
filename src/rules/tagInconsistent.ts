// Vault Doctor — TAG-INCONSISTENT rule.
// Detects sets of tags that differ only by case or trailing pluralization
// (e.g. `#projet`, `#Projet`, `#projets`) and emits one info issue per note
// that uses any non-canonical variant. Auto-fixable: rewrite all variants in
// the note to the canonical form (the most-used surface variant).

import type { Issue, Rule, ScanContext } from "../types";

// Path fragments (case-insensitive) excluded from tag-inconsistency
// scanning. Archive folders carry historical content the user has already
// decided to deprioritize — re-flagging tag drift in there is noise.
const PATH_EXCLUSIONS: readonly string[] = ["_archive/"];

function isPathExcluded(path: string): boolean {
  const lower = path.toLowerCase();
  for (const fragment of PATH_EXCLUSIONS) {
    if (lower.includes(fragment)) return true;
  }
  return false;
}

function canonicalize(tag: string): string {
  const stripped = tag.replace(/^#+/, "").toLowerCase();
  if (stripped.endsWith("ies") && stripped.length > 3) {
    return stripped.slice(0, -3) + "y";
  }
  if (stripped.endsWith("es") && stripped.length > 2) {
    return stripped.slice(0, -2);
  }
  if (stripped.endsWith("s") && stripped.length > 1) {
    return stripped.slice(0, -1);
  }
  return stripped;
}

export const TAG_INCONSISTENT_RULE: Rule = {
  id: "TAG-INCONSISTENT",
  name: "Inconsistent tags",
  severity: "info",
  category: "Tags",
  description:
    "Tags that differ only in case or pluralization — likely the same logical tag",
  weight: 2,
  evaluate(ctx: ScanContext): Issue[] {
    // Group every distinct surface tag in the vault by its canonical form,
    // remembering which notes used each surface variant.
    const groups = new Map<
      string,
      Map<string, Set<string>>
    >(); // canonical -> (surface -> note paths)

    for (const [surfaceTag, paths] of ctx.vault.tags.entries()) {
      const canonical = canonicalize(surfaceTag);
      let group = groups.get(canonical);
      if (group === undefined) {
        group = new Map();
        groups.set(canonical, group);
      }
      let bucket = group.get(surfaceTag);
      if (bucket === undefined) {
        bucket = new Set();
        group.set(surfaceTag, bucket);
      }
      for (const path of paths) {
        if (isPathExcluded(path)) continue;
        bucket.add(path);
      }
    }

    const issues: Issue[] = [];

    for (const [canonical, surfaces] of groups.entries()) {
      if (surfaces.size < 2) continue;

      // Pick the most-used surface variant as canonical. Stable tie-break by
      // the surface form itself so the suggestion is deterministic across runs.
      let winner: string | null = null;
      let winnerCount = -1;
      for (const [surface, paths] of surfaces.entries()) {
        const count = paths.size;
        if (
          count > winnerCount ||
          (count === winnerCount &&
            winner !== null &&
            surface < winner)
        ) {
          winner = surface;
          winnerCount = count;
        }
      }
      if (winner === null) continue;

      const variantList = Array.from(surfaces.keys()).sort();
      const variantSummary = variantList.join(", ");

      // Emit one issue per (note, non-canonical surface) pair so the user can
      // act on each occurrence individually from the dashboard list.
      const reportedPerNote = new Set<string>();
      for (const [surface, paths] of surfaces.entries()) {
        if (surface === winner) continue;
        for (const notePath of paths) {
          if (reportedPerNote.has(notePath)) continue;
          reportedPerNote.add(notePath);
          issues.push({
            ruleId: TAG_INCONSISTENT_RULE.id,
            severity: TAG_INCONSISTENT_RULE.severity,
            notePath,
            message: `Tag variants for "${canonical}": ${variantSummary} → ${winner}`,
            context: {
              targetPath: winner,
            },
            suggestedAction: "fix",
          });
        }
      }
    }

    return issues;
  },
};
