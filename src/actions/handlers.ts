// Vault Doctor — per-action handlers.
//
// Each handler resolves the issue's `notePath` to a TFile and performs a
// single side-effect through Obsidian's safe APIs. Handlers throw on failure;
// the dispatcher (./dispatcher.ts) is responsible for catching and aggregating
// errors into an ActionResult.
//
// Safety notes (PRD §9):
//   - trashFile uses the *system* trash, never `app.vault.delete()`.
//   - whitelist persists via frontmatter so the marker survives reindex.
//   - archive renames into `_archive/<original-path>` to preserve folder
//     structure and avoid name collisions across folders.

import { type Plugin, TFile, TFolder } from "obsidian";
import type { Issue } from "../types";

const ARCHIVE_ROOT = "_archive";

/**
 * Resolve `issue.notePath` to a `TFile`. Throws when the path is missing or
 * points at a folder. Errors here propagate to the dispatcher which records
 * them in `ActionResult.errors`.
 */
function resolveFile(plugin: Plugin, issue: Issue): TFile {
  const abs = plugin.app.vault.getAbstractFileByPath(issue.notePath);
  if (abs === null) {
    throw new Error(`File not found: ${issue.notePath}`);
  }
  if (!(abs instanceof TFile)) {
    throw new Error(`Path is not a file: ${issue.notePath}`);
  }
  return abs;
}

/**
 * Move a note into `_archive/<original-path>`, creating the archive root and
 * any intermediate folders on the fly. Idempotent for missing folders, but
 * will fail if the destination already exists (caller can re-trigger after
 * resolving the conflict).
 */
export async function archive(plugin: Plugin, issue: Issue): Promise<void> {
  const file = resolveFile(plugin, issue);
  const newPath = `${ARCHIVE_ROOT}/${file.path}`;

  await ensureFolder(plugin, ARCHIVE_ROOT);
  // Mirror the source folder hierarchy under _archive/ so two notes named
  // "index.md" in different folders don't collide.
  const parentDir = parentDirOf(newPath);
  if (parentDir !== "" && parentDir !== ARCHIVE_ROOT) {
    await ensureFolder(plugin, parentDir);
  }

  await plugin.app.fileManager.renameFile(file, newPath);
}

/**
 * Send the note to the *system* trash via Obsidian's safe API. NEVER use
 * `app.vault.delete()` — that's a hard delete with no recovery path.
 */
export async function trashFile(plugin: Plugin, issue: Issue): Promise<void> {
  const file = resolveFile(plugin, issue);
  await plugin.app.vault.trash(file, true);
}

/**
 * Persist a "do not flag this file again" marker.
 *
 *   - Markdown notes:  `vault-doctor: ignore` in frontmatter (survives reindex,
 *                      travels with the file if it's moved across vaults).
 *   - Other files:     append the path to settings.whitelistedPaths since
 *                      `processFrontMatter` only works on markdown.
 *
 * The scanner consults both mechanisms when building the vault index, so
 * downstream rules don't need to know which one was used.
 */
export async function whitelist(plugin: Plugin, issue: Issue): Promise<void> {
  const file = resolveFile(plugin, issue);
  if (file.extension === "md") {
    await plugin.app.fileManager.processFrontMatter(file, (fm) => {
      fm["vault-doctor"] = "ignore";
    });
    return;
  }

  // Non-markdown (image, PDF, audio, …): persist via the settings list.
  const pluginWithSettings = plugin as Plugin & {
    settings?: {
      values: { whitelistedPaths: string[] };
      update: (key: "whitelistedPaths", value: string[]) => Promise<void>;
    };
  };
  const store = pluginWithSettings.settings;
  if (store === undefined) {
    throw new Error(
      "Settings store unavailable; cannot whitelist non-markdown file",
    );
  }
  const current = store.values.whitelistedPaths;
  if (current.includes(file.path)) return; // already whitelisted, no-op
  await store.update("whitelistedPaths", [...current, file.path]);
}

/**
 * Open the issue's source note in the active leaf. Uses `openLinkText` so
 * Obsidian handles relative path resolution and pane-switching consistently
 * with native click-on-link behaviour.
 */
export async function openNote(plugin: Plugin, issue: Issue): Promise<void> {
  await plugin.app.workspace.openLinkText(issue.notePath, "");
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function ensureFolder(plugin: Plugin, path: string): Promise<void> {
  const existing = plugin.app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFolder) return;
  if (existing !== null) {
    throw new Error(`Path exists but is not a folder: ${path}`);
  }
  try {
    await plugin.app.vault.createFolder(path);
  } catch (err) {
    // Race or already-exists: tolerate when the folder exists by the time we
    // check again. Re-throw anything else.
    const recheck = plugin.app.vault.getAbstractFileByPath(path);
    if (recheck instanceof TFolder) return;
    throw err;
  }
}

function parentDirOf(path: string): string {
  const idx = path.lastIndexOf("/");
  if (idx === -1) return "";
  return path.slice(0, idx);
}
