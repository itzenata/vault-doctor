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

import type { Plugin } from "obsidian";
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

export class Scanner {
  private readonly plugin: Plugin;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  /**
   * Walk the vault and build a fully resolved index.
   */
  async buildIndex(): Promise<VaultIndex> {
    const app = this.plugin.app;
    const notes = new Map<string, NoteMeta>();
    const attachments = new Map<string, AttachmentMeta>();
    const outbound = new Map<string, LinkMeta[]>();
    const inbound = new Map<string, LinkMeta[]>();
    const tags = new Map<string, string[]>();

    // ---- Pass 1 — markdown notes -------------------------------------------
    const mdFiles = app.vault.getMarkdownFiles();

    for (const file of mdFiles) {
      const content = await app.vault.cachedRead(file);
      const rawLinks = parseLinks(file.path, content);

      // resolve each link via metadataCache
      const resolvedLinks: LinkMeta[] = rawLinks.map((link) => {
        const dest = app.metadataCache.getFirstLinkpathDest(
          link.target,
          file.path,
        );
        return dest === null ? link : { ...link, resolved: true };
      });

      const cache = app.metadataCache.getFileCache(file);
      const frontmatter =
        cache?.frontmatter !== undefined
          ? this.cloneFrontmatter(cache.frontmatter)
          : undefined;
      const noteTags = cache?.tags?.map((t) => t.tag) ?? [];

      const meta: NoteMeta = {
        path: file.path,
        basename: file.basename,
        size: file.stat.size,
        ctime: file.stat.ctime,
        mtime: file.stat.mtime,
        frontmatter,
        outboundLinks: resolvedLinks,
        inboundLinks: [], // filled in pass 2
        tags: noteTags,
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
   */
  async scan(): Promise<ScanResult> {
    const start = Date.now();
    const vault = await this.buildIndex();

    const issues: Issue[] = [];
    for (const rule of ALL_RULES) {
      const ruleIssues = rule.evaluate({ vault, rule });
      for (const issue of ruleIssues) issues.push(issue);
    }

    const score = computeScore(issues, ALL_RULES);
    const durationMs = Date.now() - start;

    return {
      scannedAt: Date.now(),
      noteCount: vault.notes.size,
      attachmentCount: vault.attachments.size,
      issues,
      score,
      durationMs,
    };
  }

  // ---- helpers -------------------------------------------------------------

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
