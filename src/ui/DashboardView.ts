import { ItemView, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import type { Issue, Rule, ScanResult, Severity } from "../types";
import type { VaultDoctorPluginWithEngine } from "../engine";
import { ALL_RULES } from "../rules";

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

const SEV_ORDER: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

interface VerdictBand {
  text: string;
  color: string;
}

const NOT_IMPL = "Action not yet implemented";

export class DashboardView extends ItemView {
  static readonly VIEW_TYPE = "vault-doctor-dashboard";

  private readonly plugin: VaultDoctorPluginWithEngine;
  private currentResult: ScanResult | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: VaultDoctorPluginWithEngine) {
    super(leaf);
    this.plugin = plugin;
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
    this.contentEl.addClass("vault-doctor-pane");
    this.currentResult = null;
    this.render(null);

    // Auto-scan on open. Don't await — empty state stays visible until done.
    // If the engine hasn't attached the scanner yet (race during plugin load),
    // skip the auto-scan and let the user trigger it via the Re-scan chip.
    if (this.plugin.scanner !== undefined) {
      void this.runScan();
    }
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  // -------------------------------------------------------------------------
  // Top-level render
  // -------------------------------------------------------------------------

  private render(result: ScanResult | null): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("vault-doctor-pane");

    this.renderHeader(root, result);
    this.renderSummary(root, result);
    this.renderSectionLabel(root);
    this.renderTable(root, result);
    this.renderFooter(root, result);
  }

  // -------------------------------------------------------------------------
  // Scan lifecycle
  // -------------------------------------------------------------------------

  private async runScan(): Promise<void> {
    const scanner = this.plugin.scanner;
    if (scanner === undefined) {
      new Notice("Scanner not ready yet");
      return;
    }
    new Notice("Scanning vault...");
    try {
      const result = await scanner.scan();
      this.currentResult = result;
      this.render(result);
      new Notice(
        `Vault score: ${Math.round(result.score)} · ${result.issues.length} issues`,
      );
    } catch (err) {
      new Notice(`Scan failed: ${String(err)}`);
    }
  }

  // -------------------------------------------------------------------------
  // Sections
  // -------------------------------------------------------------------------

  private renderHeader(parent: HTMLElement, result: ScanResult | null): void {
    const header = parent.createDiv({ cls: "vd-pane-header" });

    const title = header.createDiv({ cls: "vd-pane-title" });
    const iconWrap = title.createSpan({ cls: "vd-pane-title-icon" });
    this.applyIcon(iconWrap, ICON_PRIMARY, ICON_FALLBACK);
    title.createSpan({ text: "Vault Doctor" });

    header.createSpan({ cls: "vd-spacer" });

    const metaText =
      result === null
        ? "No scan yet"
        : `Scanned ${result.noteCount} notes · ${formatRelativeTime(result.scannedAt)}`;
    header.createSpan({ cls: "vd-meta", text: metaText });

    const kbd = header.createSpan({ cls: "vd-kbd", text: "⌘R" });
    kbd.setAttr("title", "Re-scan vault");
    kbd.addEventListener("click", () => {
      void this.runScan();
    });

    const settingsBtn = header.createEl("button", { cls: "vd-icon-btn" });
    settingsBtn.setAttr("title", "Settings");
    settingsBtn.setAttr("aria-label", "Settings");
    this.applyIcon(settingsBtn, "settings", "cog");
    settingsBtn.addEventListener("click", () => {
      new Notice(NOT_IMPL);
    });
  }

  private renderSummary(parent: HTMLElement, result: ScanResult | null): void {
    const summary = parent.createDiv({ cls: "vd-summary" });

    const scoreMax = 100;
    const scoreNum: number =
      result === null ? 0 : Math.round(result.score);
    const verdict: VerdictBand =
      result === null
        ? { text: "No scan yet", color: "var(--vd-orange)" }
        : verdictFor(scoreNum);

    // Gauge ------------------------------------------------------------------
    const gauge = summary.createDiv({ cls: "vd-gauge" });

    const size = 132;
    const radius = 56;
    const stroke = 10;
    const circumference = 2 * Math.PI * radius;
    const ratio =
      result === null ? 0 : Math.max(0, Math.min(1, scoreNum / scoreMax));
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
    ringFg.setAttr(
      "stroke-dasharray",
      `${filled.toFixed(2)} ${remaining.toFixed(2)}`,
    );
    ringFg.setAttr("stroke-linecap", "round");
    // Override the CSS-defined stroke per verdict band (CSS would otherwise
    // beat any presentation attribute we set here).
    ringFg.style.stroke = verdict.color;

    const scoreEl = gauge.createDiv({ cls: "vd-score-num" });
    const numEl = scoreEl.createDiv({
      cls: "vd-score-num-num",
      text: result === null ? "--" : String(scoreNum),
    });
    numEl.style.color = verdict.color;
    scoreEl.createDiv({ cls: "vd-score-num-denom", text: `/ ${scoreMax}` });

    // Verdict ---------------------------------------------------------------
    const verdictWrap = summary.createDiv({ cls: "vd-verdict-wrap" });
    const verdictEl = verdictWrap.createDiv({
      cls: "vd-verdict",
      text: verdict.text,
    });
    verdictEl.style.color = verdict.color;

    const sub = verdictWrap.createDiv({ cls: "vd-verdict-sub" });
    if (result === null) {
      sub.appendText("Click Re-scan to begin");
    } else {
      const issueCount = result.issues.length;
      if (issueCount === 0) {
        sub.appendText("No issues across your vault");
      } else {
        sub.appendText(`${issueCount} issues across your vault`);
      }
    }

    // Tag pills -------------------------------------------------------------
    const tags = summary.createDiv({ cls: "vd-tags" });
    const counts = countBySeverity(result?.issues ?? []);
    const sevs: Severity[] = ["critical", "warning", "info"];
    for (const sev of sevs) {
      tags.createSpan({
        cls: `vd-tag ${SEV_CLASS[sev]}`,
        text: `${counts[sev]} ${SEV_LABEL[sev]}`,
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
      new Notice(NOT_IMPL);
    });
  }

  private renderTable(parent: HTMLElement, result: ScanResult | null): void {
    const table = parent.createDiv({ cls: "vd-table" });

    const issues = result?.issues ?? [];
    const rows = ALL_RULES.map((rule) => ({
      rule,
      count: issues.filter((i) => i.ruleId === rule.id).length,
    }));

    // Sort: by severity (critical first), then by descending count.
    rows.sort((a, b) => {
      const sevDiff = SEV_ORDER[a.rule.severity] - SEV_ORDER[b.rule.severity];
      if (sevDiff !== 0) return sevDiff;
      return b.count - a.count;
    });

    // Hide rules with 0 issues UNLESS we're in empty state.
    const visible = result === null ? rows : rows.filter((r) => r.count > 0);

    // Auto-expand the first critical rule with at least one issue.
    let firstCriticalWithIssues: string | null = null;
    if (result !== null) {
      for (const r of visible) {
        if (r.rule.severity === "critical" && r.count > 0) {
          firstCriticalWithIssues = r.rule.id;
          break;
        }
      }
    }

    for (const { rule, count } of visible) {
      const expanded = rule.id === firstCriticalWithIssues;
      this.renderRow(table, rule, count, expanded);
      if (expanded) {
        const ruleIssues = issues.filter((i) => i.ruleId === rule.id);
        this.renderDetail(table, rule, ruleIssues);
      }
    }
  }

  private renderRow(
    parent: HTMLElement,
    rule: Rule,
    count: number,
    expanded: boolean,
  ): void {
    const sevCls = SEV_CLASS[rule.severity];
    const rowEl = parent.createDiv({
      cls: `vd-row ${sevCls}${expanded ? " expanded" : ""}`,
    });

    rowEl.createSpan({ cls: "vd-dot" });

    const name = rowEl.createSpan({ cls: "vd-row-name" });
    name.appendText(rule.name);

    rowEl.createSpan({ cls: "vd-row-count", text: String(count) });
    rowEl.createSpan({ cls: "vd-row-sev", text: SEV_LABEL[rule.severity] });
    rowEl.createSpan({ cls: "vd-row-arrow", text: "›" });

    rowEl.addEventListener("click", () => {
      new Notice(NOT_IMPL);
    });
  }

  private renderDetail(
    parent: HTMLElement,
    rule: Rule,
    issues: Issue[],
  ): void {
    const detail = parent.createDiv({ cls: "vd-detail" });

    const examples = issues.slice(0, 3);
    if (examples.length === 0) {
      detail.createDiv({
        cls: "vd-detail-empty",
        text: "No example issues",
      });
    } else {
      for (const issue of examples) {
        const itemEl = detail.createDiv({ cls: "vd-detail-item" });
        const target = issue.context?.targetPath ?? "?";
        itemEl.createSpan({ cls: "vd-detail-link", text: `[[${target}]]` });
        itemEl.createSpan({ cls: "vd-detail-path", text: issue.notePath });
        itemEl.createSpan({ cls: "vd-detail-open", text: "›" });
        itemEl.addEventListener("click", () => {
          new Notice(NOT_IMPL);
        });
      }
    }

    const actions = detail.createDiv({ cls: "vd-detail-actions" });

    const primary = actions.createEl("button", { cls: "vd-btn primary" });
    primary.appendText(`Fix all ${issues.length}`);
    primary.appendText(" ");
    primary.createSpan({ cls: "vd-kbd-mini", text: "⌘↵" });
    primary.addEventListener("click", () => {
      new Notice(NOT_IMPL);
    });

    for (const secondary of ["Show all", "Whitelist"]) {
      const btn = actions.createEl("button", { cls: "vd-btn", text: secondary });
      btn.addEventListener("click", () => {
        new Notice(NOT_IMPL);
      });
    }
  }

  private renderFooter(parent: HTMLElement, result: ScanResult | null): void {
    const footer = parent.createDiv({ cls: "vd-footer" });

    const label = footer.createSpan({ cls: "vd-footer-label" });

    if (result === null) {
      label.appendText("Run a scan to see your vault's hygiene");
    } else {
      const score = Math.round(result.score);
      const critCount = result.issues.filter(
        (i) => i.severity === "critical",
      ).length;

      if (result.issues.length === 0) {
        label.appendText("No issues to fix");
      } else {
        // TODO: real projected score from rule weights
        const projectedScore = Math.min(100, score + critCount * 2);
        const gain = projectedScore - score;
        label.appendText(
          `Fix ${critCount} critical issues · projected `,
        );
        label.createSpan({
          cls: "vd-footer-gain",
          text: `${projectedScore} (+${gain})`,
        });
      }
    }

    const cta = footer.createEl("button", { cls: "vd-footer-cta" });
    cta.appendText("Start guided cleanup");
    cta.appendText(" ");
    cta.createSpan({ cls: "vd-kbd-mini", text: "⌘↵" });
    cta.addEventListener("click", () => {
      new Notice("Guided cleanup not yet implemented");
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

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function verdictFor(score: number): VerdictBand {
  if (score >= 90) return { text: "Excellent", color: "var(--vd-good)" };
  if (score >= 70) return { text: "Good", color: "var(--vd-good)" };
  if (score >= 50)
    return { text: "Attention needed", color: "var(--vd-orange)" };
  return { text: "Cleanup urgent", color: "var(--vd-critical)" };
}

function countBySeverity(issues: Issue[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, warning: 0, info: 0 };
  for (const issue of issues) counts[issue.severity] += 1;
  return counts;
}

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
