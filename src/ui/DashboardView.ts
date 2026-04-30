import { ItemView, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import type { Severity } from "../types";

// ---------------------------------------------------------------------------
// Mock data — mirrors mockup.html. Real engine wiring lands in a follow-up.
// ---------------------------------------------------------------------------

interface MockDetailItem {
  link: string;
  path: string;
}

interface MockIssueRow {
  name: string;
  meta?: string;
  count: number;
  severity: Severity;
  expanded?: boolean;
  detail?: {
    items: MockDetailItem[];
    primaryAction: { label: string; kbd?: string };
    secondaryActions: string[];
  };
}

interface MockGroup {
  severity: Severity;
  total: number;
  rows: MockIssueRow[];
}

interface MockDashboard {
  score: number;
  scoreMax: number;
  verdict: string;
  verdictSub: string;
  delta: string;
  meta: string;
  tags: { count: number; severity: Severity }[];
  groups: MockGroup[];
  footer: { label: string; gain: string; cta: string; ctaKbd: string };
}

const MOCK: MockDashboard = {
  score: 67,
  scoreMax: 100,
  verdict: "Attention needed",
  verdictSub: "76 issues across your vault",
  delta: "↓ 8 points",
  meta: "4,217 notes · 2m ago",
  tags: [
    { count: 12, severity: "critical" },
    { count: 23, severity: "warning" },
    { count: 41, severity: "info" },
  ],
  groups: [
    {
      severity: "critical",
      total: 12,
      rows: [
        {
          name: "Broken internal links",
          count: 7,
          severity: "critical",
          expanded: true,
          detail: {
            items: [
              { link: "[[Project Notes 2024]]", path: "daily/2025-08-12.md" },
              { link: "[[Q3 Roadmap]]", path: "projects/launch.md" },
              { link: "[[Old Meeting Notes]]", path: "archive/2023/2023-11-meetings.md" },
            ],
            primaryAction: { label: "Fix all 7", kbd: "⌘↵" },
            secondaryActions: ["Show all", "Whitelist"],
          },
        },
        { name: "Broken embeds", count: 3, severity: "critical" },
        { name: "Exact duplicates", count: 2, severity: "critical" },
      ],
    },
    {
      severity: "warning",
      total: 23,
      rows: [
        { name: "Orphan notes", count: 18, severity: "warning" },
        { name: "Empty notes", count: 5, severity: "warning" },
      ],
    },
    {
      severity: "info",
      total: 41,
      rows: [
        { name: "Unused attachments", meta: "· 84 MB", count: 28, severity: "info" },
        { name: "Inconsistent tags", count: 13, severity: "info" },
      ],
    },
  ],
  footer: {
    label: "Fix 12 critical issues · projected",
    gain: "82 (+15)",
    cta: "Start guided cleanup",
    ctaKbd: "⌘↵",
  },
};

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

const ICON_PRIMARY = "stethoscope";
const ICON_FALLBACK = "activity";

const SEV_CLASS: Record<Severity, string> = {
  critical: "critical",
  warning: "warning",
  info: "info",
};

const SEV_LABEL: Record<Severity, string> = {
  critical: "critical",
  warning: "warning",
  info: "info",
};

export class DashboardView extends ItemView {
  static readonly VIEW_TYPE = "vault-doctor-dashboard";

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return DashboardView.VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Vault Doctor";
  }

  getIcon(): string {
    return ICON_PRIMARY;
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("vault-doctor-pane");

    this.renderHeader(root);
    this.renderSummary(root);
    this.renderSectionLabel(root);
    this.renderTable(root);
    this.renderFooter(root);
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  // -------------------------------------------------------------------------
  // Sections
  // -------------------------------------------------------------------------

  private renderHeader(parent: HTMLElement): void {
    const header = parent.createDiv({ cls: "vd-pane-header" });

    const title = header.createDiv({ cls: "vd-pane-title" });
    const iconWrap = title.createSpan({ cls: "vd-pane-title-icon" });
    this.applyIcon(iconWrap, ICON_PRIMARY, ICON_FALLBACK);
    title.createSpan({ text: "Vault Doctor" });

    header.createSpan({ cls: "vd-spacer" });
    header.createSpan({ cls: "vd-meta", text: MOCK.meta });

    const kbd = header.createSpan({ cls: "vd-kbd", text: "⌘R" });
    kbd.setAttr("title", "Re-scan vault");
    kbd.addEventListener("click", () => {
      new Notice("not yet wired");
    });

    const settingsBtn = header.createEl("button", { cls: "vd-icon-btn" });
    settingsBtn.setAttr("title", "Settings");
    settingsBtn.setAttr("aria-label", "Settings");
    this.applyIcon(settingsBtn, "settings", "cog");
    settingsBtn.addEventListener("click", () => {
      new Notice("not yet wired");
    });
  }

  private renderSummary(parent: HTMLElement): void {
    const summary = parent.createDiv({ cls: "vd-summary" });

    // Gauge ------------------------------------------------------------------
    const gauge = summary.createDiv({ cls: "vd-gauge" });

    const size = 132;
    const radius = 56;
    const stroke = 10;
    const circumference = 2 * Math.PI * radius;
    const ratio = Math.max(0, Math.min(1, MOCK.score / MOCK.scoreMax));
    const filled = circumference * ratio;
    const remaining = circumference - filled;

    const svg = gauge.createSvg("svg");
    svg.setAttr("width", String(size));
    svg.setAttr("height", String(size));
    svg.setAttr("viewBox", `0 0 ${size} ${size}`);

    const ringBg = svg.createSvg("circle");
    ringBg.addClass("vd-ring-bg");
    ringBg.setAttr("cx", "66");
    ringBg.setAttr("cy", "66");
    ringBg.setAttr("r", String(radius));
    ringBg.setAttr("fill", "none");
    ringBg.setAttr("stroke-width", String(stroke));

    const ringFg = svg.createSvg("circle");
    ringFg.addClass("vd-ring-fg");
    ringFg.setAttr("cx", "66");
    ringFg.setAttr("cy", "66");
    ringFg.setAttr("r", String(radius));
    ringFg.setAttr("fill", "none");
    ringFg.setAttr("stroke-width", String(stroke));
    ringFg.setAttr("stroke-dasharray", `${filled.toFixed(2)} ${remaining.toFixed(2)}`);
    ringFg.setAttr("stroke-linecap", "round");

    const scoreNum = gauge.createDiv({ cls: "vd-score-num" });
    scoreNum.createDiv({ cls: "vd-score-num-num", text: String(MOCK.score) });
    scoreNum.createDiv({ cls: "vd-score-num-denom", text: `/ ${MOCK.scoreMax}` });

    // Verdict ---------------------------------------------------------------
    const verdictWrap = summary.createDiv({ cls: "vd-verdict-wrap" });
    verdictWrap.createDiv({ cls: "vd-verdict", text: MOCK.verdict });
    const sub = verdictWrap.createDiv({ cls: "vd-verdict-sub" });
    sub.appendText(`${MOCK.verdictSub} · `);
    sub.createSpan({ cls: "vd-verdict-delta", text: MOCK.delta });
    sub.appendText(" in the last 30 days");

    // Tag pills -------------------------------------------------------------
    const tags = summary.createDiv({ cls: "vd-tags" });
    for (const tag of MOCK.tags) {
      tags.createSpan({
        cls: `vd-tag ${SEV_CLASS[tag.severity]}`,
        text: `${tag.count} ${SEV_LABEL[tag.severity]}`,
      });
    }
  }

  private renderSectionLabel(parent: HTMLElement): void {
    const label = parent.createDiv({ cls: "vd-section-label" });
    label.createSpan({ text: "Issues" });

    const right = label.createSpan({ cls: "vd-section-label-right" });
    right.appendText("Sort by impact ");
    const link = right.createEl("a", { text: "change ↕" });
    link.setAttr("href", "#");
    link.addEventListener("click", (evt) => {
      evt.preventDefault();
      new Notice("not yet wired");
    });
  }

  private renderTable(parent: HTMLElement): void {
    const table = parent.createDiv({ cls: "vd-table" });

    for (const group of MOCK.groups) {
      for (const row of group.rows) {
        this.renderRow(table, row);
        if (row.expanded && row.detail) {
          this.renderDetail(table, row);
        }
      }
    }
  }

  private renderRow(parent: HTMLElement, row: MockIssueRow): void {
    const sevCls = SEV_CLASS[row.severity];
    const rowEl = parent.createDiv({
      cls: `vd-row ${sevCls}${row.expanded ? " expanded" : ""}`,
    });

    rowEl.createSpan({ cls: "vd-dot" });

    const name = rowEl.createSpan({ cls: "vd-row-name" });
    name.appendText(row.name);
    if (row.meta) {
      name.createSpan({ cls: "vd-row-name-meta", text: ` ${row.meta}` });
    }

    rowEl.createSpan({ cls: "vd-row-count", text: String(row.count) });
    rowEl.createSpan({ cls: "vd-row-sev", text: SEV_LABEL[row.severity] });
    rowEl.createSpan({ cls: "vd-row-arrow", text: "›" });

    rowEl.addEventListener("click", () => {
      new Notice("not yet wired");
    });
  }

  private renderDetail(parent: HTMLElement, row: MockIssueRow): void {
    if (!row.detail) return;
    const detail = parent.createDiv({ cls: "vd-detail" });

    for (const item of row.detail.items) {
      const itemEl = detail.createDiv({ cls: "vd-detail-item" });
      itemEl.createSpan({ cls: "vd-detail-link", text: item.link });
      itemEl.createSpan({ cls: "vd-detail-path", text: item.path });
      itemEl.createSpan({ cls: "vd-detail-open", text: "›" });
      itemEl.addEventListener("click", () => {
        new Notice("not yet wired");
      });
    }

    const actions = detail.createDiv({ cls: "vd-detail-actions" });

    const primary = actions.createEl("button", { cls: "vd-btn primary" });
    primary.appendText(row.detail.primaryAction.label);
    if (row.detail.primaryAction.kbd) {
      primary.appendText(" ");
      primary.createSpan({ cls: "vd-kbd-mini", text: row.detail.primaryAction.kbd });
    }
    primary.addEventListener("click", () => {
      new Notice("not yet wired");
    });

    for (const secondary of row.detail.secondaryActions) {
      const btn = actions.createEl("button", { cls: "vd-btn", text: secondary });
      btn.addEventListener("click", () => {
        new Notice("not yet wired");
      });
    }
  }

  private renderFooter(parent: HTMLElement): void {
    const footer = parent.createDiv({ cls: "vd-footer" });

    const label = footer.createSpan({ cls: "vd-footer-label" });
    label.appendText(`${MOCK.footer.label} `);
    label.createSpan({ cls: "vd-footer-gain", text: MOCK.footer.gain });

    const cta = footer.createEl("button", { cls: "vd-footer-cta" });
    cta.appendText(MOCK.footer.cta);
    cta.appendText(" ");
    cta.createSpan({ cls: "vd-kbd-mini", text: MOCK.footer.ctaKbd });
    cta.addEventListener("click", () => {
      new Notice("not yet wired");
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Apply a Lucide icon by name. Falls back to a secondary icon and finally
   * to a textual glyph if the Obsidian icon set is missing the requested name.
   */
  private applyIcon(target: HTMLElement, name: string, fallback: string): void {
    try {
      setIcon(target, name);
      if (target.childElementCount === 0) {
        setIcon(target, fallback);
      }
    } catch {
      try {
        setIcon(target, fallback);
      } catch {
        target.setText("•");
      }
    }
  }
}
