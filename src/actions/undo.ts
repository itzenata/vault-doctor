// Vault Doctor — undo manager (PRD §C6).
//
// Keeps a sliding window of the most-recent destructive batches the user
// applied. Each entry is a backup manifest written by `snapshotIssues`;
// "undo" restores every file the manifest captured.
//
// Trash interaction: when the original action was `delete`, the file lives
// in the OS trash, not in the vault — Obsidian's API can't pull it back.
// We restore from the snapshot directly, which writes the file content back
// into the vault. The trash copy becomes redundant but harmless.
//
// History size: PRD §C6 specifies 50 last operations. We don't enforce a
// time-based eviction (the "7 days" PRD line) — manifests on disk persist
// until the user clears them or runs out of disk; the in-memory ring keeps
// the most recent 50 references regardless of age.

import type { Plugin } from "obsidian";
import {
  type BackupManifest,
  listBackups,
  restoreBackup,
} from "./backup";

const HISTORY_LIMIT = 50;

export interface UndoManager {
  /** Push a manifest onto the head of the history. Evicts past LIMIT. */
  record(manifest: BackupManifest): void;
  /** Most-recent manifest, or null when nothing to undo. */
  peek(): BackupManifest | null;
  /** Pop the head and return how many files were restored. */
  undoLast(): Promise<number>;
  /** Read-only snapshot of the current history (newest first). */
  list(): readonly BackupManifest[];
}

/**
 * Build the in-memory undo manager. Hydrates from disk on construction so
 * a plugin reload doesn't lose the user's recent history.
 */
export async function createUndoManager(
  plugin: Plugin,
): Promise<UndoManager> {
  const history: BackupManifest[] = [];

  // Hydrate from the on-disk backup directory. `listBackups` returns newest
  // first; we keep the first HISTORY_LIMIT.
  const persisted = await listBackups(plugin);
  for (let i = 0; i < persisted.length && i < HISTORY_LIMIT; i++) {
    history.push(persisted[i]);
  }

  return {
    record(manifest: BackupManifest): void {
      history.unshift(manifest);
      if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT;
    },
    peek(): BackupManifest | null {
      return history.length > 0 ? history[0] : null;
    },
    async undoLast(): Promise<number> {
      const head = history.shift();
      if (head === undefined) return 0;
      return restoreBackup(plugin, head);
    },
    list(): readonly BackupManifest[] {
      return history;
    },
  };
}
