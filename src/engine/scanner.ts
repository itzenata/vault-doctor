// Vault Doctor — scan engine.
//
// Scanner.buildIndex() walks the vault once: for each markdown file it
// reads the cached content, parses internal links, resolves them through
// Obsidian's metadataCache, and accumulates per-note metadata. Non-markdown
// files become AttachmentMeta entries. Inbound link maps are derived in a
// single second pass over outbound link arrays.
//
// Scanner.scan() runs every rule in ALL_RULES against the resulting index
// and aggregates a ScanResult, including a 0-100 hygiene score.

import type { Plugin, TFile } from "obsidian";
import type {
  AttachmentMeta,
  Issue,
  LinkMeta,
  NoteMeta,
  ScanResult,
  VaultIndex,
} from "../types";
import { parseLinks } from "./linkParser";
import { computeScore } from "./scoring";
import { ALL_RULES } from "../rules";
import type { VaultDoctorSettings } from "../settings/types";

interface ExclusionConfig {
  folders: string[]; // already normalized: lowercased, no leading/trailing slash
  tags: string[]; // already normalized: lowercased, no leading "#"
  whitelistedPaths: Set<string>; // exact-match path lookup
}

const EMPTY_EXCLUSIONS: ExclusionConfig = {
  folders: [],
  tags: [],
  whitelistedPaths: new Set(),
};

export class Scanner {
  private readonly plugin: Plugin;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  /**
   * Walk the vault and build a fully resolved index.
   *
   * `exclusions` controls which notes and attachments are pruned from the
   * resulting index. Excluded notes never appear in `notes`, never appear as
   * outbound-link sources, and (because their outbound edges are dropped) do
   * not contribute inbound entries to the surviving notes. Excluded folders
   * also remove matching attachments.
   */
  async buildIndex(
    exclusions: ExclusionConfig = EMPTY_EXCLUSIONS,
  ): Promise<VaultIndex> {
    const app = this.plugin.app;
    const notes = new Map<string, NoteMeta>();
    const attachments = new Map<string, AttachmentMeta>();
    const outbound = new Map<string, LinkMeta[]>();
    const inbound = new Map<string, LinkMeta[]>();
    const tags = new Map<string, string[]>();

    // ---- Pass 1 — markdown notes -------------------------------------------
    const mdFiles = app.vault.getMarkdownFiles();

    for (const file of mdFiles) {
      const cache = app.metadataCache.getFileCache(file);
      const noteTags = cache?.tags?.map((t) => t.tag) ?? [];

      if (this.shouldSkipNote(file, noteTags, exclusions)) continue;
      // Honour explicit whitelist: per-file `vault-doctor: ignore` frontmatter
      // OR inclusion in `settings.whitelistedPaths`. Either path keeps the
      // note out of every rule downstream.
      if (exclusions.whitelistedPaths.has(file.path)) continue;
      if (cache?.frontmatter?.["vault-doctor"] === "ignore") continue;

      const content = await app.vault.cachedRead(file);
      const body = stripFrontmatter(content);
      const rawLinks = parseLinks(file.path, content);

      // resolve each link via metadataCache
      const resolvedLinks: LinkMeta[] = rawLinks.map((link) => {
        const dest = app.metadataCache.getFirstLinkpathDest(
          link.target,
          file.path,
        );
        return dest === null ? link : { ...link, resolved: true };
      });

      const frontmatter =
        cache?.frontmatter !== undefined
          ? this.cloneFrontmatter(cache.frontmatter)
          : undefined;

      const meta: NoteMeta = {
        path: file.path,
        basename: file.basename,
        size: file.stat.size,
        bodyLength: body.length,
        ctime: file.stat.ctime,
        mtime: file.stat.mtime,
        frontmatter,
        outboundLinks: resolvedLinks,
        inboundLinks: [], // filled in pass 2
        tags: noteTags,
        contentHash: hashBody(body),
      };

      notes.set(file.path, meta);
      outbound.set(file.path, resolvedLinks);

      for (const tag of noteTags) {
        const list = tags.get(tag);
        if (list === undefined) tags.set(tag, [file.path]);
        else list.push(file.path);
      }
    }

    // ---- Pass 2 — inbound link map -----------------------------------------
    // For every resolved outbound link, record the reverse edge keyed by the
    // resolved destination path (we re-resolve here to obtain the path).
    // Excluded notes never made it into `notes`, so their outbound edges are
    // already absent — no need to re-check sources here.
    for (const note of notes.values()) {
      for (const link of note.outboundLinks) {
        if (!link.resolved) continue;
        const dest = app.metadataCache.getFirstLinkpathDest(
          link.target,
          note.path,
        );
        if (dest === null) continue;
        this.pushInbound(inbound, dest.path, link);
      }
    }

    // hydrate NoteMeta.inboundLinks now that the map is complete
    for (const note of notes.values()) {
      const incoming = inbound.get(note.path);
      if (incoming !== undefined) note.inboundLinks = incoming;
    }

    // ---- Pass 3 — attachments ----------------------------------------------
    const allFiles = app.vault.getFiles();
    for (const file of allFiles) {
      if (file.extension === "md") continue;
      if (this.matchesExcludedFolder(file.path, exclusions.folders)) continue;
      if (exclusions.whitelistedPaths.has(file.path)) continue;
      const refs = inbound.get(file.path) ?? [];
      const att: AttachmentMeta = {
        path: file.path,
        size: file.stat.size,
        references: refs.map((l) => l.source),
      };
      attachments.set(file.path, att);
    }

    return { notes, attachments, outbound, inbound, tags };
  }

  /**
   * Build the index and run every rule against it.
   *
   * On completion, fires a workspace event so other modules (status bar, UI,
   * future subscribers) can react without a direct reference to the Scanner:
   *
   *   Event name : `vault-doctor:scan-complete`
   *   Payload    : `ScanResult` (the same value this method returns)
   *
   * Subscribe with:
   *   `app.workspace.on("vault-doctor:scan-complete", (result: ScanResult) => { ... })`
   */
  async scan(): Promise<ScanResult> {
    const start = Date.now();

    // Resolve settings at scan start. The settings module attaches a
    // `settings` field to the plugin instance — but registration order is not
    // guaranteed (engine may be wired before settings, and tests may skip it
    // entirely). When absent, fall back to "everything enabled, no
    // exclusions" — matching the pre-settings behaviour.
    const pluginWithSettings = this.plugin as Plugin &
      Partial<{ settings: { values: VaultDoctorSettings } }>;
    const settings = pluginWithSettings.settings?.values;

    const exclusions: ExclusionConfig =
      settings === undefined
        ? EMPTY_EXCLUSIONS
        : {
            folders: normalizeFolderEntries(settings.excludedFolders),
            tags: normalizeTagEntries(settings.excludedTags),
            whitelistedPaths: new Set(settings.whitelistedPaths ?? []),
          };

    // A rule id missing from the persisted map (e.g. a rule shipped after the
    // user last opened the settings tab) defaults to enabled — hence `!==
    // false` rather than `=== true`.
    const activeRules =
      settings !== undefined
        ? ALL_RULES.filter((r) => settings.enabledRules[r.id] !== false)
        : ALL_RULES;

    const vault = await this.buildIndex(exclusions);

    const rawIssues: Issue[] = [];
    for (const rule of activeRules) {
      const ruleIssues = rule.evaluate({ vault, rule });
      for (const issue of ruleIssues) rawIssues.push(issue);
    }

    const issues = suppressShadowedIssues(rawIssues);

    // Score against `activeRules` so disabled rules don't inflate the
    // penalty potential — with all rules off, score stays at 100.
    const score = computeScore(issues, activeRules);
    const durationMs = Date.now() - start;

    const result: ScanResult = {
      scannedAt: Date.now(),
      noteCount: vault.notes.size,
      attachmentCount: vault.attachments.size,
      issues,
      score,
      durationMs,
    };

    this.plugin.app.workspace.trigger("vault-doctor:scan-complete", result);

    return result;
  }

  // ---- helpers -------------------------------------------------------------

  /**
   * True when `file` should be omitted from the index because of folder or
   * tag exclusions. Folder match is case-insensitive against the file path;
   * tag match is case-insensitive and tolerant of leading `#`.
   */
  private shouldSkipNote(
    file: TFile,
    noteTags: string[],
    exclusions: ExclusionConfig,
  ): boolean {
    if (this.matchesExcludedFolder(file.path, exclusions.folders)) return true;
    if (exclusions.tags.length === 0) return false;

    for (const raw of noteTags) {
      const normalized = raw.replace(/^#+/, "").toLowerCase();
      if (exclusions.tags.includes(normalized)) return true;
    }
    return false;
  }

  /**
   * Folder match rule: case-insensitive substring match on the file path,
   * with the entry's leading and trailing slashes stripped before comparison.
   * A path matches an entry `foo` when it (a) starts with `foo/` or (b)
   * contains `/foo/`. This catches both top-level (`foo/bar.md`) and nested
   * (`a/foo/bar.md`) placement without false-matching prefixes (`foobar/...`).
   */
  private matchesExcludedFolder(
    filePath: string,
    folders: string[],
  ): boolean {
    if (folders.length === 0) return false;
    const lowerPath = filePath.toLowerCase();
    for (const folder of folders) {
      if (folder.length === 0) continue;
      if (
        lowerPath.startsWith(`${folder}/`) ||
        lowerPath.includes(`/${folder}/`)
      ) {
        return true;
      }
    }
    return false;
  }

  private pushInbound(
    map: Map<string, LinkMeta[]>,
    destPath: string,
    link: LinkMeta,
  ): void {
    const existing = map.get(destPath);
    if (existing === undefined) map.set(destPath, [link]);
    else existing.push(link);
  }

  /**
   * Obsidian's FrontMatterCache is typed as `{ [key: string]: any }`. We copy
   * its enumerable keys into a fresh `Record<string, unknown>` to avoid
   * leaking `any` into our own types.
   */
  private cloneFrontmatter(fm: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(fm)) {
      out[key] = fm[key];
    }
    return out;
  }

}

/**
 * Normalize folder entries: lowercase, drop leading/trailing slashes and
 * whitespace. Empty entries are dropped so they can't match every path.
 */
function normalizeFolderEntries(entries: string[]): string[] {
  const out: string[] = [];
  for (const entry of entries) {
    const trimmed = entry.trim().replace(/^\/+|\/+$/g, "").toLowerCase();
    if (trimmed.length > 0) out.push(trimmed);
  }
  return out;
}

/**
 * Normalize tag entries: lowercase, strip a leading `#`, drop empty entries.
 * Tags in `metadataCache` arrive prefixed with `#`; this lets the user write
 * `wip` or `#wip` interchangeably in settings.
 */
function normalizeTagEntries(entries: string[]): string[] {
  const out: string[] = [];
  for (const entry of entries) {
    const trimmed = entry.trim().replace(/^#+/, "").toLowerCase();
    if (trimmed.length > 0) out.push(trimmed);
  }
  return out;
}

/**
 * Drop ORPHAN-NOTE issues for notes that another, more-specific rule has
 * already flagged. Rationale: a note that is empty / duplicate / oversized /
 * tag-inconsistent is already going to be addressed; re-flagging it as an
 * orphan adds dashboard noise without new information. STALE-NOTE is
 * intentionally NOT a shadowing rule — staleness and orphanhood are
 * independent signals and a note can deserve both labels.
 */
const ORPHAN_SHADOWING_RULES: ReadonlySet<string> = new Set([
  "EMPTY-NOTE",
  "DUPLICATE-EXACT",
  "OVERSIZED-NOTE",
  "TAG-INCONSISTENT",
]);

function suppressShadowedIssues(issues: Issue[]): Issue[] {
  const shadowedNotes = new Set<string>();
  for (const issue of issues) {
    if (!ORPHAN_SHADOWING_RULES.has(issue.ruleId)) continue;
    shadowedNotes.add(issue.notePath);
    // DUPLICATE-EXACT reports only the non-canonical sibling; the canonical's
    // path lives in `context.targetPath`. Shadow it too so neither member of
    // the duplicate pair is re-flagged as ORPHAN-NOTE. Other shadowing rules
    // either don't set `targetPath` (EMPTY-NOTE, OVERSIZED-NOTE) or use it for
    // a non-path value (TAG-INCONSISTENT carries the canonical tag), so we
    // gate on the rule id.
    if (issue.ruleId === "DUPLICATE-EXACT") {
      const target = issue.context?.targetPath;
      if (target !== undefined) shadowedNotes.add(target);
    }
  }
  if (shadowedNotes.size === 0) return issues;

  const out: Issue[] = [];
  for (const issue of issues) {
    if (issue.ruleId === "ORPHAN-NOTE" && shadowedNotes.has(issue.notePath)) {
      continue;
    }
    out.push(issue);
  }
  return out;
}

/**
 * Hash a note body for duplicate detection. Whitespace is collapsed so
 * trivial reformatting (added blank lines, trailing spaces) does not mask a
 * true duplicate. FNV-1a 32-bit is sufficient: this hash is consumed only by
 * the DUPLICATE-EXACT rule, which compares against same-length bodies — the
 * accidental-collision risk on a single vault is vanishingly small.
 */
function hashBody(body: string): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Strip a leading YAML frontmatter block from `content` and return the body.
 *
 * Conservative detection: the file must begin with a line that is exactly
 * `---` (trailing whitespace allowed), followed by a newline. We then look for
 * the next line that is exactly `---` (again, optional trailing whitespace),
 * either followed by a newline or sitting at end-of-file. If either delimiter
 * is missing the entire `content` is treated as body.
 */
function stripFrontmatter(content: string): string {
  // Opening delimiter: `---` on the very first line, optional trailing
  // whitespace, terminated by `\n`.
  const openMatch = /^---[ \t]*\n/.exec(content);
  if (openMatch === null) return content;

  const afterOpen = openMatch[0].length;

  // Closing delimiter: a line that is exactly `---` (optional trailing
  // whitespace) — either followed by a newline or anchored at end-of-string.
  const closeRe = /\n---[ \t]*(?:\n|$)/g;
  closeRe.lastIndex = afterOpen;
  const closeMatch = closeRe.exec(content);
  if (closeMatch === null) return content;

  return content.slice(closeMatch.index + closeMatch[0].length);
}
