// Vault Doctor — confirmation policy.
//
// Pure logic: given an action and a scope size, decide whether the user
// should be prompted before the dispatcher proceeds. PRD §9 requires:
//   - destructive actions always confirmed
//   - bulk operations (>5) confirmed even when non-destructive
//   - whitelist / open never need confirmation (cheap, reversible)

import type { ActionId } from "../types";

const BULK_THRESHOLD = 5;

/**
 * Whether `actionId` over `scopeSize` issues should pop a confirmation modal.
 *
 * - delete  → always (destructive)
 * - archive → only when bulk > 5 (single-file archive is reversible via the
 *             system file manager)
 * - whitelist → never (purely additive frontmatter)
 * - open      → never (read-only)
 * - fix       → only for batches (scopeSize > 1). The user is about to walk
 *               through N picker modals; a top-level "you'll be asked to pick
 *               replacements for N issues, continue?" prompt prevents
 *               accidental clicks. Single-issue fix opens the picker
 *               directly — that's already a per-issue decision.
 */
export function requiresConfirmation(
  actionId: ActionId,
  scopeSize: number,
): boolean {
  switch (actionId) {
    case "delete":
      return true;
    case "archive":
      return scopeSize > BULK_THRESHOLD;
    case "whitelist":
    case "open":
      return false;
    case "fix":
      return scopeSize > 1;
  }
}

export const BULK_CONFIRMATION_THRESHOLD = BULK_THRESHOLD;
