// Vault Doctor — rule registry.
// All shipped rules are aggregated here so the scanner can iterate them.

import type { Rule } from "../types";
import { BROKEN_LINK_RULE } from "./brokenLink";
import { BROKEN_EMBED_RULE } from "./brokenEmbed";
import { ORPHAN_NOTE_RULE } from "./orphanNote";
import { EMPTY_NOTE_RULE } from "./emptyNote";
import { ORPHAN_ATTACHMENT_RULE } from "./orphanAttachment";

export const ALL_RULES: Rule[] = [
  BROKEN_LINK_RULE,
  BROKEN_EMBED_RULE,
  ORPHAN_NOTE_RULE,
  EMPTY_NOTE_RULE,
  ORPHAN_ATTACHMENT_RULE,
];

export {
  BROKEN_LINK_RULE,
  BROKEN_EMBED_RULE,
  ORPHAN_NOTE_RULE,
  EMPTY_NOTE_RULE,
  ORPHAN_ATTACHMENT_RULE,
};
