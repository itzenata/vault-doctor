// Vault Doctor — shared type contracts.
// Both the scan engine (src/engine) and the UI (src/ui) depend on these.

export type Severity = "critical" | "warning" | "info";

export type ActionId =
  | "archive"
  | "delete"
  | "whitelist"
  | "fix"
  | "remove"
  | "open";

export interface Issue {
  ruleId: string;
  severity: Severity;
  notePath: string;
  message: string;
  context?: {
    line?: number;
    column?: number;
    targetPath?: string;
  };
  suggestedAction?: ActionId;
}

export interface Rule {
  id: string;
  name: string;
  severity: Severity;
  category: string;
  description: string;
  weight: number;
  evaluate(ctx: ScanContext): Issue[];
}

export interface NoteMeta {
  path: string;
  basename: string;
  size: number;
  /** Length in characters of the note body, excluding YAML frontmatter. */
  bodyLength: number;
  ctime: number;
  mtime: number;
  frontmatter?: Record<string, unknown>;
  outboundLinks: LinkMeta[];
  inboundLinks: LinkMeta[];
  tags: string[];
  contentHash?: string;
}

export interface AttachmentMeta {
  path: string;
  size: number;
  references: string[];
}

export interface LinkMeta {
  source: string;
  target: string;
  raw: string;
  resolved: boolean;
  type: "wikilink" | "embed" | "markdown";
  line?: number;
}

export interface VaultIndex {
  notes: Map<string, NoteMeta>;
  attachments: Map<string, AttachmentMeta>;
  // adjacency by source-note path
  outbound: Map<string, LinkMeta[]>;
  inbound: Map<string, LinkMeta[]>;
  tags: Map<string, string[]>; // tag -> note paths using it
}

export interface ScanContext {
  vault: VaultIndex;
  rule: Rule;
}

export interface ScanResult {
  scannedAt: number;
  noteCount: number;
  attachmentCount: number;
  issues: Issue[];
  score: number;
  durationMs: number;
}
