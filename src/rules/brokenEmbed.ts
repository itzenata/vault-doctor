// Vault Doctor — BROKEN-EMBED rule.
// Emits one critical issue per unresolved internal embed (`![[...]]`).

import type { Issue, Rule, ScanContext } from "../types";

export const BROKEN_EMBED_RULE: Rule = {
  id: "BROKEN-EMBED",
  name: "Broken embed",
  severity: "critical",
  category: "Liens & références",
  description:
    "An embed `![[...]]` references a file (note or attachment) that does not exist in the vault.",
  weight: 8,
  evaluate(ctx: ScanContext): Issue[] {
    const issues: Issue[] = [];
    for (const note of ctx.vault.notes.values()) {
      for (const link of note.outboundLinks) {
        if (link.type !== "embed") continue;
        if (link.resolved) continue;
        issues.push({
          ruleId: BROKEN_EMBED_RULE.id,
          severity: BROKEN_EMBED_RULE.severity,
          notePath: note.path,
          message: `Broken embed to ![[${link.target}]]`,
          context: {
            line: link.line,
            targetPath: link.target,
          },
          suggestedAction: "fix",
        });
      }
    }
    return issues;
  },
};
