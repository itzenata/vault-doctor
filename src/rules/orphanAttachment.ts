// Vault Doctor — ORPHAN-ATTACHMENT rule.
// Emits one info-level issue per non-markdown file that no note references,
// excluding Obsidian's own internal/system folders.

import type { Issue, Rule, ScanContext } from "../types";

// Path prefixes (case-insensitive) that exclude an attachment from the check.
// `.obsidian/` is plugin/config storage; `.trash/` is Obsidian's soft-delete bin.
const PATH_EXCLUSIONS: readonly string[] = [".obsidian/", ".trash/"];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)} GB`;
}

export const ORPHAN_ATTACHMENT_RULE: Rule = {
  id: "ORPHAN-ATTACHMENT",
  name: "Orphan attachment",
  severity: "info",
  category: "Pièces jointes",
  description:
    "Attachment file (image/PDF/etc.) not referenced by any note",
  weight: 3,
  evaluate(ctx: ScanContext): Issue[] {
    const issues: Issue[] = [];
    for (const attachment of ctx.vault.attachments.values()) {
      if (attachment.references.length > 0) continue;

      const lowerPath = attachment.path.toLowerCase();
      let excludedByPath = false;
      for (const fragment of PATH_EXCLUSIONS) {
        if (lowerPath.includes(fragment)) {
          excludedByPath = true;
          break;
        }
      }
      if (excludedByPath) continue;

      issues.push({
        ruleId: ORPHAN_ATTACHMENT_RULE.id,
        severity: ORPHAN_ATTACHMENT_RULE.severity,
        notePath: attachment.path,
        message: `Unused attachment (${formatBytes(attachment.size)})`,
        suggestedAction: "delete",
      });
    }
    return issues;
  },
};
