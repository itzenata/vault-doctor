// Vault Doctor — fix-tag-inconsistent action.
//
// Rewrites every non-canonical tag variant in the issue's source note to
// the canonical surface form. The TAG-INCONSISTENT rule packs the canonical
// in `issue.context.targetPath` (a non-path string for this rule).
//
// Strategy:
//   - Read the file body once via `vault.process`.
//   - For each surface variant in the same canonical group, replace
//     `#variant` → `#canonical`. The variant set is derived from the issue's
//     `tags` field on the source note's metadata cache, filtered to those
//     that share the canonical form.
//   - Skip occurrences inside fenced code blocks / inline code (the link
//     parser strips these for detection; rewrites should be just as careful).

import { type Plugin, TFile } from "obsidian";
import type { Issue } from "../types";
import type { FixOutcome } from "./fixBrokenLink";

/**
 * Apply the TAG-INCONSISTENT auto-fix to one issue. Returns a `FixOutcome`
 * compatible with the dispatcher's existing fix-loop bookkeeping.
 */
export async function fixTagInconsistent(
  plugin: Plugin,
  issue: Issue,
): Promise<FixOutcome> {
  // The rule packs the winner surface variant in `targetPath`. Obsidian's
  // metadataCache returns tags WITH a leading `#` (e.g. "#Projet"), so the
  // rule passes that through verbatim. We strip the `#` here once so the
  // rest of this handler can work on bare surface strings — comparing them
  // against `tag.replace(/^#+/, "")` from the same metadata source, and
  // splicing them back as `#${winner}` exactly once at write time.
  const rawTarget = issue.context?.targetPath;
  if (rawTarget === undefined || rawTarget === "") {
    return {
      applied: false,
      skipped: false,
      error: "Issue has no canonical tag in context.targetPath",
    };
  }
  const winnerSurface = rawTarget.replace(/^#+/, "");
  if (winnerSurface === "") {
    return {
      applied: false,
      skipped: false,
      error: `Invalid target tag: ${rawTarget}`,
    };
  }
  const canonicalKey = canonicalize(winnerSurface);

  const abs = plugin.app.vault.getAbstractFileByPath(issue.notePath);
  if (!(abs instanceof TFile)) {
    return {
      applied: false,
      skipped: false,
      error: `Source note not found or not a file: ${issue.notePath}`,
    };
  }

  // Build the variant set from the file's tag metadata. We restrict to tags
  // whose canonical form equals the target — every other tag in the note is
  // out of scope. The rule doesn't pack the variant list, so we re-derive it
  // here; cheap (a single note's tag count is small).
  const cache = plugin.app.metadataCache.getFileCache(abs);
  const tagsInNote = cache?.tags?.map((t) => t.tag) ?? [];
  const variants = new Set<string>();
  for (const tag of tagsInNote) {
    const surface = tag.replace(/^#+/, "");
    if (canonicalize(surface) !== canonicalKey) continue;
    if (surface === winnerSurface) continue; // already the target form, skip
    variants.add(surface);
  }

  // Frontmatter tags also count and are read by `metadataCache.tags` only
  // when written inline. For YAML-list `tags:` fields, the cache exposes them
  // via `frontmatter.tags`. Cover that surface too so YAML-tag inconsistency
  // is fixable, not just inline `#tag` text.
  const fmTags = cache?.frontmatter?.tags;
  const fmTagList: string[] =
    typeof fmTags === "string"
      ? [fmTags]
      : Array.isArray(fmTags)
        ? fmTags.filter((x): x is string => typeof x === "string")
        : [];
  for (const fmTag of fmTagList) {
    const surface = fmTag.replace(/^#+/, "");
    if (canonicalize(surface) !== canonicalKey) continue;
    if (surface === winnerSurface) continue;
    variants.add(surface);
  }

  if (variants.size === 0) {
    return {
      applied: false,
      skipped: false,
      error: `No non-canonical variants of "${winnerSurface}" found in note`,
    };
  }

  let inlineReplacements = 0;
  try {
    await plugin.app.vault.process(abs, (content) => {
      const rewritten = rewriteInlineTags(content, variants, winnerSurface);
      inlineReplacements = rewritten.count;
      return rewritten.content;
    });
  } catch (err) {
    return {
      applied: false,
      skipped: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // YAML-tag rewrite goes through the dedicated frontmatter API so
  // formatting (block-list, comma-list) and other fields are preserved.
  let frontmatterReplacements = 0;
  if (fmTagList.length > 0) {
    try {
      await plugin.app.fileManager.processFrontMatter(abs, (fm) => {
        const current = fm.tags;
        if (typeof current === "string") {
          const surface = current.replace(/^#+/, "");
          if (variants.has(surface)) {
            fm.tags = winnerSurface;
            frontmatterReplacements += 1;
          }
        } else if (Array.isArray(current)) {
          const next: string[] = [];
          for (const raw of current) {
            if (typeof raw !== "string") {
              next.push(raw);
              continue;
            }
            const surface = raw.replace(/^#+/, "");
            if (variants.has(surface)) {
              next.push(winnerSurface);
              frontmatterReplacements += 1;
            } else {
              next.push(raw);
            }
          }
          fm.tags = next;
        }
      });
    } catch (err) {
      return {
        applied: false,
        skipped: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (inlineReplacements + frontmatterReplacements === 0) {
    return {
      applied: false,
      skipped: false,
      error: `Variants "${[...variants].join(", ")}" listed in metadata but not found in file body or frontmatter`,
    };
  }

  return { applied: true, skipped: false };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * MUST mirror `canonicalize` in `src/rules/tagInconsistent.ts`. Any drift
 * means the fix would target a different group than the rule reported.
 * Kept duplicated rather than imported because rules are rule-only-pure and
 * shouldn't carry action-side dependencies.
 */
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

interface RewriteResult {
  content: string;
  count: number;
}

/**
 * Replace every inline `#variant` with `#canonical` in the file body.
 *
 * Skips occurrences inside fenced code blocks (```...```) and inline code
 * (`...`) by masking them before the rewrite pass and re-merging unchanged
 * code regions afterward. Frontmatter is also skipped — those tags are
 * handled separately via the frontmatter API.
 *
 * Word-boundary handling: we require either start-of-string or a
 * non-tag-character before the `#`, and a tag-terminator (whitespace, end
 * of string, or punctuation) after the variant — so `#projetX` doesn't
 * match when the variant is `projet`.
 */
function rewriteInlineTags(
  content: string,
  variants: Set<string>,
  canonical: string,
): RewriteResult {
  // Sort longer variants first so `projets` is matched before `projet` —
  // otherwise `#projets` would be rewritten to `#projets` (the trailing `s`
  // remaining literal). RegExp alternation tries patterns left to right.
  const sortedVariants = [...variants].sort((a, b) => b.length - a.length);
  if (sortedVariants.length === 0) return { content, count: 0 };

  // Strip frontmatter so YAML `tags:` lists aren't double-rewritten.
  const fmMatch = /^---[ \t]*\n[\s\S]*?\n---[ \t]*\n/.exec(content);
  const head = fmMatch !== null ? fmMatch[0] : "";
  const body = fmMatch !== null ? content.slice(head.length) : content;

  // Mask code regions so `#tag` inside backticks isn't rewritten. Replace
  // them with same-length placeholders so character offsets — and any later
  // splice — stay aligned with the original.
  const masked = maskCode(body);

  // Boundary handling. Before the leading `#`:
  //   - either start-of-string, or
  //   - any character that isn't a tag-body char AND isn't `#` itself.
  // The `#` exclusion matters: without it, a body that already contains
  // `#Projet` would let the regex match starting at the second `#`,
  // and the replacement would prepend a fresh `#` — producing `##Projet`.
  // After the variant: tag terminator (end-of-string or non-tag-body char).
  const escaped = sortedVariants.map(escapeRegex).join("|");
  const re = new RegExp(
    `(^|[^A-Za-z0-9_\\-/#])#(?:${escaped})(?=$|[^A-Za-z0-9_\\-/])`,
    "g",
  );

  let count = 0;
  // Replace on the masked body — but write the replacement back into the
  // *original* body at the same offsets so masked code stays untouched.
  const out: string[] = [];
  let cursor = 0;
  for (let m: RegExpExecArray | null; (m = re.exec(masked)) !== null; ) {
    const matchStart = m.index;
    const prefix = m[1];
    const matchEnd = matchStart + m[0].length;
    out.push(body.slice(cursor, matchStart));
    out.push(`${prefix}#${canonical}`);
    cursor = matchEnd;
    count += 1;
  }
  out.push(body.slice(cursor));

  return { content: head + out.join(""), count };
}

const FENCE_RE = /^(\s*)(`{3,}|~{3,})/;

/**
 * Replace fenced and inline code regions with same-length spaces. We only
 * need stable offsets — the masked output is read by the regex pass, then
 * we splice replacements back into the original. So the masked content's
 * actual characters don't matter as long as no `#` survives inside them.
 */
function maskCode(content: string): string {
  const lines = content.split("\n");
  const out: string[] = new Array(lines.length);
  let fenceMarker: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = FENCE_RE.exec(line);

    if (fenceMarker !== null) {
      if (fence !== null && line.trim().startsWith(fenceMarker)) {
        fenceMarker = null;
      }
      out[i] = " ".repeat(line.length);
      continue;
    }

    if (fence !== null) {
      fenceMarker = fence[2];
      out[i] = " ".repeat(line.length);
      continue;
    }

    // Inline code: blank out everything between matched backtick runs of
    // equal length on the same line. Unmatched backticks pass through.
    out[i] = line.replace(/`+([^`]*)`+/g, (match) => " ".repeat(match.length));
  }

  return out.join("\n");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
