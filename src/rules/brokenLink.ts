// Vault Doctor — BROKEN-LINK rule.
// Emits one critical issue per unresolved internal wikilink.

import type { Issue, Rule, ScanContext } from "../types";

export const BROKEN_LINK_RULE: Rule = {
  id: "BROKEN-LINK",
  name: "Broken wikilink",
  severity: "critical",
  category: "Liens & références",
  description:
    "An internal wikilink `[[...]]` does not resolve to any note in the vault.",
  weight: 10,
  evaluate(ctx: ScanContext): Issue[] {
    const issues: Issue[] = [];
    for (const note of ctx.vault.notes.values()) {
      for (const link of note.outboundLinks) {
        if (link.type !== "wikilink") continue;
        if (link.resolved) continue;
        issues.push({
          ruleId: BROKEN_LINK_RULE.id,
          severity: BROKEN_LINK_RULE.severity,
          notePath: note.path,
          message: `Broken link to [[${link.target}]]`,
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
