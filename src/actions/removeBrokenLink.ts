// Vault Doctor — remove-broken-link action.
//
// Non-interactive companion to fixBrokenLink: deletes the broken
// `[[wikilink]]` or `![[embed]]` from the source note rather than asking
// the user to pick a replacement. Used by the Guided Cleanup wizard so a
// "Fix all" batch on critical issues doesn't pile N SuggestModals on top
// of the apply screen.
//
// What "remove" means concretely:
//   - For a wikilink `[[Ghost Note]]` (no surrounding text), drop the link
//     entirely and clean up doubled spaces / trailing whitespace it leaves.
//   - For a wikilink with an alias `[[Ghost Note|Click here]]`, keep just
//     the alias text — the user wrote that prose for a reason.
//   - For an embed `![[missing.png]]`, drop the embed and any blank line
//     it occupied; the file isn't there, the embed served no purpose.

import { type Plugin, TFile } from "obsidian";
import type { Issue } from "../types";
import type { FixOutcome } from "./fixBrokenLink";

export async function removeBrokenLink(
  plugin: Plugin,
  issue: Issue,
): Promise<FixOutcome> {
  const oldTarget = issue.context?.targetPath;
  if (oldTarget === undefined || oldTarget === "") {
    return {
      applied: false,
      skipped: false,
      error: "Issue has no targetPath; cannot determine what to remove",
    };
  }

  const abs = plugin.app.vault.getAbstractFileByPath(issue.notePath);
  if (!(abs instanceof TFile)) {
    return {
      applied: false,
      skipped: false,
      error: `Source note not found or not a file: ${issue.notePath}`,
    };
  }

  const isEmbed = issue.ruleId === "BROKEN-EMBED";
  const lineNumber = issue.context?.line;

  let didReplace = false;
  try {
    await plugin.app.vault.process(abs, (content) => {
      const rewritten = removeFromContent({
        content,
        oldTarget,
        isEmbed,
        lineNumber,
      });
      didReplace = rewritten.replaced;
      return rewritten.content;
    });
  } catch (err) {
    return {
      applied: false,
      skipped: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (!didReplace) {
    return {
      applied: false,
      skipped: false,
      error: `No matching ${isEmbed ? "embed" : "link"} found for "${oldTarget}"`,
    };
  }

  return { applied: true, skipped: false };
}

// ---------------------------------------------------------------------------
// rewrite logic
// ---------------------------------------------------------------------------

interface RemoveInput {
  content: string;
  oldTarget: string;
  isEmbed: boolean;
  /** 1-based line from the rule. Optional. */
  lineNumber?: number;
}

interface RemoveOutput {
  content: string;
  replaced: boolean;
}

/**
 * Build a regex matching one wikilink/embed whose target equals `oldTarget`,
 * optionally followed by `#section`, `^block`, or `|alias`.
 *
 * Capture group 1 = alias text (without `|`), or undefined.
 */
function buildLinkRegex(oldTarget: string, isEmbed: boolean): RegExp {
  const escaped = escapeRegex(oldTarget);
  const tail = `(?:#[^|\\]]*)?(?:\\^[^|\\]]*)?(?:\\|([^\\]]*))?\\]\\]`;
  const body = `\\[\\[${escaped}${tail}`;
  const pattern = isEmbed ? `!${body}` : `(?<!!)${body}`;
  return new RegExp(pattern, "g");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace the matched link/embed with an "after-removal" string:
 *   - wikilink with alias  → the alias text (the user wrote that prose)
 *   - wikilink no alias    → empty string (link was the whole reference)
 *   - embed (any)          → empty string (no fallback content available)
 */
function buildReplacement(
  alias: string | undefined,
  isEmbed: boolean,
): string {
  if (isEmbed) return "";
  if (alias !== undefined && alias !== "") return alias;
  return "";
}

/**
 * Remove the broken link from `content`. Mirrors `rewriteContent` in
 * fixBrokenLink.ts:
 *   - When a line number is reported, scope the removal to that line and
 *     drop *every* matching link on it.
 *   - Otherwise, remove only the first occurrence in the file (defensive
 *     against rule false-positives).
 *
 * After the removal we do a small cleanup on the affected line(s):
 *   - collapse runs of spaces that the removal left behind
 *   - if the line is now empty (or only whitespace), drop the line entirely
 */
function removeFromContent(input: RemoveInput): RemoveOutput {
  const { content, oldTarget, isEmbed, lineNumber } = input;
  const regex = buildLinkRegex(oldTarget, isEmbed);

  if (lineNumber !== undefined && lineNumber >= 1) {
    const lines = content.split("\n");
    const idx = lineNumber - 1;
    if (idx < lines.length) {
      const before = lines[idx];
      let lineChanged = false;
      const after = before.replace(regex, (...args: unknown[]) => {
        lineChanged = true;
        const aliasGroup = args[1] as string | undefined;
        return buildReplacement(aliasGroup, isEmbed);
      });
      if (lineChanged) {
        const cleaned = cleanupLine(after);
        if (cleaned === null) {
          // Line was whitespace-only after removal — drop it.
          lines.splice(idx, 1);
        } else {
          lines[idx] = cleaned;
        }
        return { content: lines.join("\n"), replaced: true };
      }
    }
  }

  // Global, first-occurrence-only fallback. We can't easily collapse the
  // surrounding line here without resplitting on \n, so we just do the
  // replacement and accept a stray double-space — the user can polish.
  let didReplace = false;
  const out = content.replace(regex, (...args: unknown[]) => {
    if (didReplace) return args[0] as string;
    didReplace = true;
    const aliasGroup = args[1] as string | undefined;
    return buildReplacement(aliasGroup, isEmbed);
  });

  return { content: out, replaced: didReplace };
}

/**
 * Tidy up a line after a link removal. Returns null when the line ends up
 * whitespace-only (caller should drop it entirely). Otherwise:
 *   - collapse runs of >1 space into one
 *   - trim trailing whitespace
 *   - drop a leading bullet/number if the line is now just the marker
 */
function cleanupLine(line: string): string | null {
  let out = line.replace(/  +/g, " ").replace(/[ \t]+$/g, "");
  // List item that's now empty: "- ", "* ", "1. " etc.
  if (/^\s*([-*+]|\d+\.)\s*$/.test(out)) return null;
  if (/^\s*$/.test(out)) return null;
  return out;
}
