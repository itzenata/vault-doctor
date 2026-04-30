// Vault Doctor — score computation.
// PRD §6.3: score = 100 - Σ (weight × multiplier × ln(count + 1))
//   critical = 3.0, warning = 1.5, info = 0.5
// Cap to [0, 100].

import type { Issue, Rule, Severity } from "../types";

const SEVERITY_MULTIPLIER: Record<Severity, number> = {
  critical: 3.0,
  warning: 1.5,
  info: 0.5,
};

/**
 * Compute the vault hygiene score from a flat list of issues and the rules
 * that produced them. Each rule contributes a penalty equal to:
 *
 *   weight × severityMultiplier × ln(issueCount + 1)
 *
 * The result is clamped to [0, 100] and rounded to one decimal place.
 */
export function computeScore(issues: Issue[], rules: Rule[]): number {
  if (issues.length === 0) return 100;

  // Group issue counts by ruleId.
  const counts = new Map<string, number>();
  for (const issue of issues) {
    counts.set(issue.ruleId, (counts.get(issue.ruleId) ?? 0) + 1);
  }

  // Index rules by id for quick lookup of weight + severity.
  const ruleById = new Map<string, Rule>();
  for (const rule of rules) ruleById.set(rule.id, rule);

  let penalty = 0;
  for (const [ruleId, count] of counts) {
    const rule = ruleById.get(ruleId);
    if (rule === undefined) continue; // unknown ruleId — skip rather than guess
    const multiplier = SEVERITY_MULTIPLIER[rule.severity];
    penalty += rule.weight * multiplier * Math.log(count + 1);
  }

  const raw = 100 - penalty;
  const clamped = Math.max(0, Math.min(100, raw));
  return Math.round(clamped * 10) / 10;
}
