// Vault Doctor — rule registry.
// All shipped rules are aggregated here so the scanner can iterate them.

import type { Rule } from "../types";
import { BROKEN_LINK_RULE } from "./brokenLink";
import { BROKEN_EMBED_RULE } from "./brokenEmbed";
import { ORPHAN_NOTE_RULE } from "./orphanNote";
import { EMPTY_NOTE_RULE } from "./emptyNote";
import { ORPHAN_ATTACHMENT_RULE } from "./orphanAttachment";
import { OVERSIZED_NOTE_RULE } from "./oversizedNote";
import { STALE_NOTE_RULE } from "./staleNote";
import { DAILY_GAP_RULE } from "./dailyGap";
import { TAG_INCONSISTENT_RULE } from "./tagInconsistent";
import { DUPLICATE_EXACT_RULE } from "./duplicateExact";

export const ALL_RULES: Rule[] = [
  BROKEN_LINK_RULE,
  BROKEN_EMBED_RULE,
  ORPHAN_NOTE_RULE,
  EMPTY_NOTE_RULE,
  ORPHAN_ATTACHMENT_RULE,
  OVERSIZED_NOTE_RULE,
  STALE_NOTE_RULE,
  DAILY_GAP_RULE,
  TAG_INCONSISTENT_RULE,
  DUPLICATE_EXACT_RULE,
];

export {
  BROKEN_LINK_RULE,
  BROKEN_EMBED_RULE,
  ORPHAN_NOTE_RULE,
  EMPTY_NOTE_RULE,
  ORPHAN_ATTACHMENT_RULE,
  OVERSIZED_NOTE_RULE,
  STALE_NOTE_RULE,
  DAILY_GAP_RULE,
  TAG_INCONSISTENT_RULE,
  DUPLICATE_EXACT_RULE,
};
