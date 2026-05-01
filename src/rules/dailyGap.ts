// Vault Doctor — DAILY-GAP rule.
// Emits one info issue per missing day in a daily-note sequence (ISO basenames
// like `2025-04-12`), restricted to the trailing 90-day window.

import type { Issue, NoteMeta, Rule, ScanContext } from "../types";

// ISO-date basename match: YYYY-MM-DD, no extension (the basename excludes it).
const DAILY_BASENAME_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Trailing window: only consider gaps where the missing date itself falls
// within the last 90 days. Picked over the "both bracketing notes within 90
// days" interpretation because it directly answers "what dailies am I missing
// recently?" without dropping a gap whose later side is fresh but whose
// earlier side is older.
const TRAILING_WINDOW_DAYS = 90;
const TRAILING_WINDOW_MS = TRAILING_WINDOW_DAYS * ONE_DAY_MS;

// Hard cap on emitted issues to avoid blowing up the report when a vault has
// a very sparse daily-note history.
const MAX_ISSUES = 30;

interface DailyEntry {
  /** Midnight UTC for the matched ISO date. */
  time: number;
  /** ISO date string, identical to the note's basename. */
  date: string;
  note: NoteMeta;
}

function parseDailyDate(basename: string): number | null {
  if (!DAILY_BASENAME_PATTERN.test(basename)) return null;
  const time = Date.parse(`${basename}T00:00:00Z`);
  if (Number.isNaN(time)) return null;
  return time;
}

function formatIsoDate(time: number): string {
  // toISOString() yields "YYYY-MM-DDTHH:mm:ss.sssZ"; we want the date part.
  return new Date(time).toISOString().slice(0, 10);
}

export const DAILY_GAP_RULE: Rule = {
  id: "DAILY-GAP",
  name: "Daily-note gap",
  severity: "info",
  category: "Daily notes",
  description: "Missing day in a daily-note sequence",
  weight: 1,
  evaluate(ctx: ScanContext): Issue[] {
    const dailies: DailyEntry[] = [];
    for (const note of ctx.vault.notes.values()) {
      // Archived dailies aren't part of the live sequence — skip them so a
      // gap doesn't appear just because the user archived old daily notes.
      if (note.path.toLowerCase().includes("_archive/")) continue;
      const time = parseDailyDate(note.basename);
      if (time === null) continue;
      dailies.push({ time, date: note.basename, note });
    }

    if (dailies.length < 2) return [];

    dailies.sort((a, b) => a.time - b.time);

    const issues: Issue[] = [];
    const cutoff = Date.now() - TRAILING_WINDOW_MS;

    for (let i = 0; i < dailies.length - 1; i++) {
      if (issues.length >= MAX_ISSUES) break;

      const earlier = dailies[i];
      const later = dailies[i + 1];
      const gap = later.time - earlier.time;

      // Adjacent or same-day entries: no missing day between them.
      // Use a half-day epsilon to absorb any DST/parse skew.
      if (gap <= ONE_DAY_MS + ONE_DAY_MS / 2) continue;

      // Walk every missing date strictly between earlier and later.
      for (
        let missing = earlier.time + ONE_DAY_MS;
        missing < later.time;
        missing += ONE_DAY_MS
      ) {
        if (issues.length >= MAX_ISSUES) break;
        if (missing < cutoff) continue;

        const missingDate = formatIsoDate(missing);
        issues.push({
          ruleId: DAILY_GAP_RULE.id,
          severity: DAILY_GAP_RULE.severity,
          notePath: later.note.path,
          message: `Missing daily note: ${missingDate}`,
          context: {
            targetPath: missingDate,
          },
          suggestedAction: "fix",
        });
      }
    }

    return issues;
  },
};
