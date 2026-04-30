// Vault Doctor — fix-broken-link action.
//
// Interactive flow that lets the user pick a replacement target for a broken
// wikilink or embed. The flow is intentionally one-modal-per-issue so a bulk
// "Fix all N" walks the user through each one — a fully automatic resolver
// would too easily silently rewrite the wrong link.
//
// Flow:
//   1. Resolve `issue.notePath` to a TFile (the *source* note that contains
//      the broken link).
//   2. Open a SuggestModal listing every markdown file in the vault, ranked
//      by fuzzy match against `issue.context.targetPath`.
//   3. On pick, atomically rewrite the source note via `vault.process` to
//      replace the broken target with the chosen one.
//   4. On cancel (Esc / click-outside), resolve `{ skipped: true }` so the
//      dispatcher counts it under `skipped`, not `applied`.

import {
  type App,
  type FuzzyMatch,
  Notice,
  type Plugin,
  prepareFuzzySearch,
  type SearchResult,
  SuggestModal,
  TFile,
} from "obsidian";
import type { Issue } from "../types";

const MAX_SUGGESTIONS = 30;

export interface FixOutcome {
  applied: boolean;
  skipped: boolean;
  error?: string;
}

/**
 * Resolve a broken wikilink or embed by asking the user for a replacement
 * target. Returns `{ skipped: true }` when the user closes the modal without
 * picking. Errors (file gone, self-link, write failure) come back via the
 * `error` field rather than being thrown — the dispatcher aggregates these.
 */
export async function fixBrokenLink(
  plugin: Plugin,
  issue: Issue,
): Promise<FixOutcome> {
  const sourceAbs = plugin.app.vault.getAbstractFileByPath(issue.notePath);
  if (sourceAbs === null) {
    return {
      applied: false,
      skipped: false,
      error: `Source note not found: ${issue.notePath}`,
    };
  }
  if (!(sourceAbs instanceof TFile)) {
    return {
      applied: false,
      skipped: false,
      error: `Source path is not a file: ${issue.notePath}`,
    };
  }
  const sourceFile = sourceAbs;

  const initialQuery = issue.context?.targetPath ?? "";
  const oldTarget = issue.context?.targetPath ?? "";
  const isEmbed = issue.ruleId === "BROKEN-EMBED";
  const lineNumber = issue.context?.line;

  return new Promise<FixOutcome>((resolve) => {
    const modal = new ReplacementSuggester(
      plugin.app,
      initialQuery,
      async (picked: TFile | null) => {
        if (picked === null) {
          resolve({ applied: false, skipped: true });
          return;
        }

        if (picked.path === sourceFile.path) {
          resolve({
            applied: false,
            skipped: false,
            error: "Cannot link to self",
          });
          return;
        }

        if (oldTarget === "") {
          resolve({
            applied: false,
            skipped: false,
            error: "Issue has no targetPath; cannot determine what to replace",
          });
          return;
        }

        const newTarget = stripMarkdownExtension(picked.path);

        try {
          let replacedAny = false;
          await plugin.app.vault.process(sourceFile, (content) => {
            const rewritten = rewriteContent({
              content,
              oldTarget,
              newTarget,
              isEmbed,
              lineNumber,
            });
            replacedAny = rewritten.replaced;
            return rewritten.content;
          });

          if (!replacedAny) {
            resolve({
              applied: false,
              skipped: false,
              error: `No matching ${isEmbed ? "embed" : "link"} found for "${oldTarget}"`,
            });
            return;
          }

          new Notice(
            `Replaced ${isEmbed ? "embed" : "link"} → ${newTarget}`,
            2000,
          );
          resolve({ applied: true, skipped: false });
        } catch (err) {
          resolve({
            applied: false,
            skipped: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    );
    modal.open();
  });
}

// ---------------------------------------------------------------------------
// Rewrite logic
// ---------------------------------------------------------------------------

interface RewriteInput {
  content: string;
  oldTarget: string;
  newTarget: string;
  isEmbed: boolean;
  /** 1-based line number from the rule. Optional. */
  lineNumber?: number;
}

interface RewriteOutput {
  content: string;
  replaced: boolean;
}

/**
 * Rewrite a wikilink or embed by replacing `oldTarget` with `newTarget`.
 *
 * Strategy:
 *   - Build a regex that matches `[[oldTarget(#section)?(^block)?(|alias)?]]`
 *     (or the embed `![[ ... ]]` variant).
 *   - When the rule reports a line number, scope the rewrite to that single
 *     line and replace **all** occurrences on that line (handles the
 *     "two identical broken links on the same line" edge case).
 *   - When no line number is available, replace **only the first** occurrence
 *     in the whole file. This is conservative — repeated broken links across
 *     different lines should each surface as their own Issue, so a global
 *     replace would over-fire.
 *
 * Trade-off on `#section` / `^block` suffixes: the original target had a
 * heading or block ref (e.g. `[[Old#Plan]]`), and the user picked a brand new
 * note. We *drop* the suffix because the new target almost certainly doesn't
 * contain the same heading/block id. Preserving an alias is safe and useful;
 * preserving a section anchor would just produce a second broken link.
 */
export function rewriteContent(input: RewriteInput): RewriteOutput {
  const { content, oldTarget, newTarget, isEmbed, lineNumber } = input;
  const regex = buildLinkRegex(oldTarget, isEmbed);

  const replaceFn = (_match: string, alias: string | undefined): string => {
    const aliasPart = alias !== undefined && alias !== "" ? `|${alias}` : "";
    return isEmbed
      ? `![[${newTarget}${aliasPart}]]`
      : `[[${newTarget}${aliasPart}]]`;
  };

  if (lineNumber !== undefined && lineNumber >= 1) {
    const lines = content.split("\n");
    const idx = lineNumber - 1;
    if (idx < lines.length) {
      const before = lines[idx];
      let lineReplaced = false;
      const after = before.replace(regex, (...args: unknown[]) => {
        lineReplaced = true;
        const fullMatch = args[0] as string;
        const aliasGroup = args[1] as string | undefined;
        return replaceFn(fullMatch, aliasGroup);
      });
      if (lineReplaced) {
        lines[idx] = after;
        return { content: lines.join("\n"), replaced: true };
      }
      // Fall through: regex didn't match on the reported line. The line
      // numbering may be off by a frontmatter offset, so we retry globally
      // before giving up. This keeps fixes robust across rule changes.
    }
  }

  // Global, first-occurrence-only fallback.
  let didReplace = false;
  const out = content.replace(regex, (...args: unknown[]) => {
    if (didReplace) {
      // Preserve every subsequent occurrence as-is.
      return args[0] as string;
    }
    didReplace = true;
    const fullMatch = args[0] as string;
    const aliasGroup = args[1] as string | undefined;
    return replaceFn(fullMatch, aliasGroup);
  });

  return { content: out, replaced: didReplace };
}

/**
 * Build a regex matching one wikilink/embed whose target equals `oldTarget`,
 * optionally followed by `#section`, `^block`, or `|alias`.
 *
 * Capture group 1 = alias text (without the leading `|`), or undefined.
 *
 * Embed regex (isEmbed=true):
 *   /!\[\[ESCAPED(?:#[^|\]]*)?(?:\^[^|\]]*)?(?:\|([^\]]*))?\]\]/g
 *
 * Wikilink regex (isEmbed=false): same body but without the leading `!` and
 * with a negative-lookbehind so we don't accidentally match an embed:
 *   /(?<!!)\[\[ESCAPED(?:#[^|\]]*)?(?:\^[^|\]]*)?(?:\|([^\]]*))?\]\]/g
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

function stripMarkdownExtension(path: string): string {
  return path.endsWith(".md") ? path.slice(0, -3) : path;
}

// ---------------------------------------------------------------------------
// SuggestModal
// ---------------------------------------------------------------------------

class ReplacementSuggester extends SuggestModal<TFile> {
  private readonly initialQuery: string;
  private readonly onPick: (file: TFile | null) => void | Promise<void>;
  private decided = false;

  constructor(
    app: App,
    initialQuery: string,
    onPick: (file: TFile | null) => void | Promise<void>,
  ) {
    super(app);
    this.initialQuery = initialQuery;
    this.onPick = onPick;
    this.setPlaceholder("Pick a replacement note…");
  }

  onOpen(): void {
    super.onOpen();
    if (this.initialQuery !== "") {
      // Pre-fill the search input with the broken target text so the top
      // suggestion is usually the user's intended fix.
      this.inputEl.value = this.initialQuery;
      this.inputEl.dispatchEvent(new Event("input"));
    }
  }

  getSuggestions(query: string): TFile[] {
    const files = this.app.vault.getMarkdownFiles();
    const trimmed = query.trim();
    if (trimmed === "") {
      return files.slice(0, MAX_SUGGESTIONS);
    }
    // Match against basename AND full path; basename matches score higher
    // because users typically refer to notes by their short name. Without
    // this, typing "Q3 Roadmap" wouldn't surface a file named exactly that
    // unless its folder hierarchy also contained those characters.
    const fuzzy = prepareFuzzySearch(trimmed);
    const ranked: FuzzyMatch<TFile>[] = [];
    for (const file of files) {
      const baseHit: SearchResult | null = fuzzy(file.basename);
      const pathHit: SearchResult | null = fuzzy(file.path);
      const baseScore = baseHit?.score ?? Number.NEGATIVE_INFINITY;
      const pathScore = pathHit?.score ?? Number.NEGATIVE_INFINITY;
      // basename match weighted +0.5 so an exact basename beats a longer
      // path with the same characters scattered across folders
      const adjustedBase = baseHit !== null ? baseScore + 0.5 : baseScore;
      if (baseHit === null && pathHit === null) continue;
      const best = adjustedBase >= pathScore ? baseHit : pathHit;
      if (best === null) continue;
      ranked.push({ item: file, match: best });
    }
    ranked.sort((a, b) => b.match.score - a.match.score);
    return ranked.slice(0, MAX_SUGGESTIONS).map((r) => r.item);
  }

  renderSuggestion(file: TFile, el: HTMLElement): void {
    el.createEl("div", { text: file.basename });
    el.createEl("small", {
      text: file.path,
      cls: "vd-suggest-path",
    });
  }

  onChooseSuggestion(file: TFile): void {
    if (this.decided) return;
    this.decided = true;
    void this.onPick(file);
  }

  onClose(): void {
    super.onClose();
    if (!this.decided) {
      this.decided = true;
      void this.onPick(null);
    }
  }
}
