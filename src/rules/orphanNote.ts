// Vault Doctor — ORPHAN-NOTE rule.
// Emits one warning per note with no inbound or outbound links, after
// filtering out paths and frontmatter shapes that legitimately stand alone
// (templates, archives, drawings, plugin scaffolding).

import type { Issue, Rule, ScanContext } from "../types";

// Path fragments (case-insensitive) that exclude a note from the orphan check.
// Easy to extend: add new folder names here as the vault evolves.
const PATH_EXCLUSIONS: readonly string[] = [
  "templates/",
  "_archive/",
  "excalidraw/",
  "daily/",
  "daily notes/",
];

// Frontmatter keys whose truthy presence marks a note as plugin-managed,
// not an organic vault note. Skip if any of these is present and truthy.
const FRONTMATTER_EXCLUSION_KEYS: readonly string[] = [
  "templater-folder",
  "excalidraw-plugin",
  "kanban-plugin",
  "dataview-template",
];

export const ORPHAN_NOTE_RULE: Rule = {
  id: "ORPHAN-NOTE",
  name: "Orphan note",
  severity: "warning",
  category: "Liens & références",
  description:
    "Note with no inbound or outbound links — likely abandoned or unindexed",
  weight: 5,
  evaluate(ctx: ScanContext): Issue[] {
    const issues: Issue[] = [];
    for (const note of ctx.vault.notes.values()) {
      if (note.inboundLinks.length > 0) continue;
      if (note.outboundLinks.length > 0) continue;

      const lowerPath = note.path.toLowerCase();
      let excludedByPath = false;
      for (const fragment of PATH_EXCLUSIONS) {
        if (lowerPath.includes(fragment)) {
          excludedByPath = true;
          break;
        }
      }
      if (excludedByPath) continue;

      if (note.frontmatter !== undefined && note.frontmatter !== null) {
        let excludedByFrontmatter = false;
        for (const key of FRONTMATTER_EXCLUSION_KEYS) {
          const value: unknown = note.frontmatter[key];
          if (value === undefined || value === null) continue;
          if (typeof value === "boolean" && value) {
            excludedByFrontmatter = true;
            break;
          }
          if (typeof value === "string" && value.length > 0) {
            excludedByFrontmatter = true;
            break;
          }
          if (typeof value === "number" && value !== 0) {
            excludedByFrontmatter = true;
            break;
          }
          if (typeof value === "object") {
            excludedByFrontmatter = true;
            break;
          }
        }
        if (excludedByFrontmatter) continue;
      }

      issues.push({
        ruleId: ORPHAN_NOTE_RULE.id,
        severity: ORPHAN_NOTE_RULE.severity,
        notePath: note.path,
        message: "Orphan note (no inbound or outbound links)",
        suggestedAction: "archive",
      });
    }
    return issues;
  },
};
