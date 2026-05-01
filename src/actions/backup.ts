// Vault Doctor — backup manager (PRD §C7, §9).
//
// Snapshot files about to be modified by a destructive bulk action into
// `.obsidian/plugins/vault-doctor/backups/{ISO-timestamp}/`, mirroring the
// vault path so a restore is a one-shot copy back. Triggered ONLY when
// `settings.autoBackup` is on and the action will actually mutate the file
// (delete + archive — whitelist and fix are reversible without snapshots).
//
// Format: each snapshot directory contains:
//   - the original files at their original relative paths
//   - a `manifest.json` listing every snapshotted path and the action that
//     was about to run, so the undo layer can replay/revert without
//     re-scanning the directory.
//
// This module never throws. A failed snapshot returns `null` and the
// dispatcher continues with the action (the system trash + Obsidian's
// rename remain reversible by hand). We log the failure for diagnostics.

import { type Plugin, TFile } from "obsidian";
import type { ActionId, Issue } from "../types";

const BACKUP_ROOT = ".obsidian/plugins/vault-doctor/backups";

export interface BackupManifestEntry {
  /** Original vault path of the file at snapshot time. */
  path: string;
  /** Action that was about to run when the snapshot was taken. */
  action: ActionId;
  /** Size in bytes (informational; lets a future "restore" UI show totals). */
  size: number;
}

export interface BackupManifest {
  /** ISO-8601 timestamp; doubles as the snapshot directory name. */
  timestamp: string;
  /** Action id this snapshot was taken for (delete / archive). */
  action: ActionId;
  /** One entry per file successfully snapshotted. */
  entries: BackupManifestEntry[];
}

/**
 * Take a snapshot of every file referenced by `issues` whose `notePath`
 * resolves to a real `TFile`. Returns the snapshot directory path, or null
 * if backups are disabled, the issue list is empty, or every snapshot
 * attempt failed. The dispatcher consults this only for diagnostics — the
 * destructive op proceeds either way.
 *
 * The directory name is the ISO timestamp at call time (ms-resolution),
 * which doubles as a stable, sortable key for the undo manager's history.
 */
export async function snapshotIssues(
  plugin: Plugin,
  actionId: ActionId,
  issues: Issue[],
): Promise<BackupManifest | null> {
  if (!shouldBackup(plugin, actionId)) return null;
  if (issues.length === 0) return null;

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const snapshotDir = `${BACKUP_ROOT}/${timestamp}`;

  const adapter = plugin.app.vault.adapter;
  const entries: BackupManifestEntry[] = [];
  const seen = new Set<string>();

  for (const issue of issues) {
    if (seen.has(issue.notePath)) continue;
    seen.add(issue.notePath);

    const abs = plugin.app.vault.getAbstractFileByPath(issue.notePath);
    if (!(abs instanceof TFile)) continue;

    try {
      const dest = `${snapshotDir}/${issue.notePath}`;
      await ensureAdapterFolder(adapter, parentDirOf(dest));
      // Use the binary path: cachedRead/read are markdown-only and would
      // mishandle attachments (PNGs, PDFs) which are valid delete targets.
      const data = await plugin.app.vault.readBinary(abs);
      await adapter.writeBinary(dest, data);
      entries.push({ path: abs.path, action: actionId, size: abs.stat.size });
    } catch (err) {
      console.warn(
        `[Vault Doctor] backup failed for ${issue.notePath}:`,
        err,
      );
    }
  }

  if (entries.length === 0) return null;

  const manifest: BackupManifest = {
    timestamp,
    action: actionId,
    entries,
  };

  try {
    await adapter.write(
      `${snapshotDir}/manifest.json`,
      JSON.stringify(manifest, null, 2),
    );
  } catch (err) {
    console.warn(
      `[Vault Doctor] backup manifest write failed for ${snapshotDir}:`,
      err,
    );
  }

  return manifest;
}

/**
 * Read a backup manifest from disk. Used by the undo layer to find which
 * paths to restore. Returns null when the file is missing, malformed, or
 * unreadable — callers fall back to "nothing to restore".
 */
export async function readBackupManifest(
  plugin: Plugin,
  timestamp: string,
): Promise<BackupManifest | null> {
  const adapter = plugin.app.vault.adapter;
  const path = `${BACKUP_ROOT}/${timestamp}/manifest.json`;
  try {
    const raw = await adapter.read(path);
    const parsed: unknown = JSON.parse(raw);
    if (!isBackupManifest(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * List all snapshot directories under the backup root, newest first. Each
 * entry's `timestamp` doubles as the directory name and the manifest's
 * `timestamp` field. Returns `[]` when the backup root doesn't exist yet.
 */
export async function listBackups(plugin: Plugin): Promise<BackupManifest[]> {
  const adapter = plugin.app.vault.adapter;
  try {
    const exists = await adapter.exists(BACKUP_ROOT);
    if (!exists) return [];
    const listing = await adapter.list(BACKUP_ROOT);
    const out: BackupManifest[] = [];
    for (const folder of listing.folders) {
      const name = folder.split("/").pop();
      if (name === undefined) continue;
      const manifest = await readBackupManifest(plugin, name);
      if (manifest !== null) out.push(manifest);
    }
    out.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    return out;
  } catch (err) {
    console.warn("[Vault Doctor] listBackups failed:", err);
    return [];
  }
}

/**
 * Restore every file in a manifest back to its original path. Used by
 * "Restore last backup" / undo. Files that already exist at the destination
 * are skipped (no overwrite without a separate confirmation flow). Returns
 * the number of files actually restored.
 */
export async function restoreBackup(
  plugin: Plugin,
  manifest: BackupManifest,
): Promise<number> {
  const adapter = plugin.app.vault.adapter;
  const snapshotDir = `${BACKUP_ROOT}/${manifest.timestamp}`;
  let restored = 0;

  for (const entry of manifest.entries) {
    const src = `${snapshotDir}/${entry.path}`;
    try {
      const exists = await adapter.exists(entry.path);
      if (exists) continue; // don't clobber a file the user has since recreated
      await ensureAdapterFolder(adapter, parentDirOf(entry.path));
      const data = await adapter.readBinary(src);
      await adapter.writeBinary(entry.path, data);
      restored += 1;
    } catch (err) {
      console.warn(
        `[Vault Doctor] restore failed for ${entry.path}:`,
        err,
      );
    }
  }

  return restored;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function shouldBackup(plugin: Plugin, actionId: ActionId): boolean {
  if (actionId !== "delete" && actionId !== "archive") return false;
  const pluginWithSettings = plugin as Plugin & {
    settings?: { values: { autoBackup: boolean } };
  };
  const enabled = pluginWithSettings.settings?.values.autoBackup;
  // Default to ON when the settings store hasn't initialised yet — PRD §9
  // says backups are non-negotiable, so the safe default trumps "feature off".
  return enabled !== false;
}

interface MinimalAdapter {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
}

async function ensureAdapterFolder(
  adapter: MinimalAdapter,
  path: string,
): Promise<void> {
  if (path === "" || path === "/") return;
  const exists = await adapter.exists(path);
  if (exists) return;
  // Walk up the path so each ancestor is created in order — `mkdir` on most
  // adapters is non-recursive.
  const parent = parentDirOf(path);
  if (parent !== "" && parent !== path) {
    await ensureAdapterFolder(adapter, parent);
  }
  await adapter.mkdir(path);
}

function parentDirOf(path: string): string {
  const idx = path.lastIndexOf("/");
  if (idx === -1) return "";
  return path.slice(0, idx);
}

function isBackupManifest(v: unknown): v is BackupManifest {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  if (typeof obj.timestamp !== "string") return false;
  if (typeof obj.action !== "string") return false;
  if (!Array.isArray(obj.entries)) return false;
  for (const e of obj.entries) {
    if (typeof e !== "object" || e === null) return false;
    const entry = e as Record<string, unknown>;
    if (typeof entry.path !== "string") return false;
    if (typeof entry.action !== "string") return false;
    if (typeof entry.size !== "number") return false;
  }
  return true;
}
