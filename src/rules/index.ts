// Vault Doctor — rule registry.
// All shipped rules are aggregated here so the scanner can iterate them.

import type { Rule } from "../types";
import { BROKEN_LINK_RULE } from "./brokenLink";
import { BROKEN_EMBED_RULE } from "./brokenEmbed";

export const ALL_RULES: Rule[] = [BROKEN_LINK_RULE, BROKEN_EMBED_RULE];

export { BROKEN_LINK_RULE, BROKEN_EMBED_RULE };
