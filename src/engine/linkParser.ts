// Vault Doctor — link parser.
// Extracts internal Obsidian links (wikilinks + embeds) from raw markdown.
// Code fences (```...```) and inline code (`...`) are stripped before scanning
// so links inside code blocks are ignored. Resolution against the vault index
// happens later (in the scanner); every link returned here has resolved=false.

import type { LinkMeta } from "../types";

const FENCE_RE = /^(\s*)(`{3,}|~{3,})/;

/**
 * Strip code fences and inline code from `content`, replacing them with
 * spaces so character offsets and line numbers remain stable.
 */
function maskCode(content: string): string {
  const lines = content.split("\n");
  const out: string[] = new Array(lines.length);
  let fenceMarker: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = FENCE_RE.exec(line);

    if (fenceMarker !== null) {
      // currently inside a fenced block — blank the line entirely
      if (fence !== null && line.trim().startsWith(fenceMarker)) {
        fenceMarker = null;
      }
      out[i] = " ".repeat(line.length);
      continue;
    }

    if (fence !== null) {
      // opening fence (we don't render the rest of this line either)
      fenceMarker = fence[2];
      out[i] = " ".repeat(line.length);
      continue;
    }

    // mask inline code spans `...` (single-line, non-greedy)
    out[i] = line.replace(/`[^`\n]*`/g, (match) => " ".repeat(match.length));
  }

  return out.join("\n");
}

/**
 * Compute 1-based line number from a character index in `content`.
 */
function lineFromIndex(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content.charCodeAt(i) === 10 /* \n */) line++;
  }
  return line;
}

/**
 * Resolve the "target name" portion of a link.
 *
 * Input examples:
 *   "Note"                  -> "Note"
 *   "Note|Alias"            -> "Note"
 *   "folder/Note#Heading"   -> "folder/Note"
 *   "Note^block-id"         -> "Note"
 *   "#Heading"              -> ""           (in-note anchor — we drop it)
 */
function extractTarget(inner: string): string {
  // alias splits first
  const aliasIdx = inner.indexOf("|");
  const head = aliasIdx >= 0 ? inner.slice(0, aliasIdx) : inner;

  // anchor (#) or block-ref (^) — whichever comes first
  let anchorIdx = -1;
  for (let i = 0; i < head.length; i++) {
    const ch = head.charCodeAt(i);
    if (ch === 35 /* # */ || ch === 94 /* ^ */) {
      anchorIdx = i;
      break;
    }
  }
  const target = anchorIdx >= 0 ? head.slice(0, anchorIdx) : head;
  return target.trim();
}

/**
 * Parse all internal links (wikilinks + embeds) from a markdown document.
 *
 * @param sourcePath  vault-relative path of the note (used as `LinkMeta.source`)
 * @param content     raw markdown
 */
export function parseLinks(sourcePath: string, content: string): LinkMeta[] {
  const masked = maskCode(content);
  const links: LinkMeta[] = [];

  // Match either ![[...]] or [[...]]; capture the leading bang (if any) and inner text.
  const re = /(!?)\[\[([^\]\n]+)\]\]/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(masked)) !== null) {
    const isEmbed = m[1] === "!";
    const inner = m[2];
    const target = extractTarget(inner);

    // Drop pure in-note anchors (`[[#Heading]]`, `[[^block]]`) — no target file.
    if (target.length === 0) continue;

    links.push({
      source: sourcePath,
      target,
      raw: m[0],
      resolved: false,
      type: isEmbed ? "embed" : "wikilink",
      line: lineFromIndex(masked, m.index),
    });
  }

  return links;
}
