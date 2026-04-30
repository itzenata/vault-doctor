import { ItemView, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import type { Issue, Rule, ScanResult, Severity } from "../types";
import type { VaultDoctorPluginWithEngine } from "../engine";
import type {
  ActionResult,
  VaultDoctorPluginWithActions,
} from "../actions";
import { ALL_RULES } from "../rules";
import { ShowAllModal } from "./ShowAllModal";
import { GuidedCleanupModal } from "./GuidedCleanupModal";

type SortMode = "impact" | "count" | "name";

/**
 * The dashboard talks to both the engine (for scans) and the actions module
 * (for fix/archive/delete/whitelist/open). Intersection type keeps the cast
 * site honest as we read both shapes off the same plugin instance.
 */
type DashboardPlugin = VaultDoctorPluginWithEngine &
  VaultDoctorPluginWithActions;

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

export class DashboardView extends ItemView {
  static readonly VIEW_TYPE = "vault-doctor-dashboard";

  private readonly plugin: DashboardPlugin;
  private currentResult: ScanResult | null = null;
  private sortMode: SortMode = "impact";
  private expandedRuleIds: Set<string> = new Set();

  constructor(leaf: WorkspaceLeaf, plugin: VaultDoctorPluginWithEngine) {
    super(leaf);
    // The actions module is registered alongside the engine; we narrow once
    // here so the rest of the view never has to repeat the cast.
    this.plugin = plugin as DashboardPlugin;
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
      // Reset expansion state for the new scan; auto-expand the first
      // critical rule that has at least one issue (matches the mockup UX).
      this.expandedRuleIds = new Set();
      const firstCritIssue = result.issues.find(
        (i) => i.severity === "critical",
      );
      if (firstCritIssue) {
        this.expandedRuleIds.add(firstCritIssue.ruleId);
      }
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
      const settingHost = this.app as unknown as {
        setting: { open(): void; openTabById(id: string): void };
      };
      settingHost.setting.open();
      settingHost.setting.openTabById("vault-doctor");
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
    right.appendText(`Sort by ${this.sortMode} `);
    const link = right.createEl("a", { text: "change ↕" });
    link.setAttr("href", "#");
    link.addEventListener("click", (evt) => {
      evt.preventDefault();
      const order: SortMode[] = ["impact", "count", "name"];
      const idx = order.indexOf(this.sortMode);
      this.sortMode = order[(idx + 1) % order.length];
      this.render(this.currentResult);
    });
  }

  private renderTable(parent: HTMLElement, result: ScanResult | null): void {
    const table = parent.createDiv({ cls: "vd-table" });

    const issues = result?.issues ?? [];
    const rows = ALL_RULES.map((rule) => ({
      rule,
      count: issues.filter((i) => i.ruleId === rule.id).length,
    }));

    // Sort according to current sortMode.
    rows.sort((a, b) => {
      switch (this.sortMode) {
        case "count":
          return (
            b.count - a.count || a.rule.name.localeCompare(b.rule.name)
          );
        case "name":
          return a.rule.name.localeCompare(b.rule.name);
        case "impact":
        default: {
          const sevDiff =
            SEV_ORDER[a.rule.severity] - SEV_ORDER[b.rule.severity];
          if (sevDiff !== 0) return sevDiff;
          return b.count - a.count;
        }
      }
    });

    // Hide rules with 0 issues UNLESS we're in empty state.
    const visible = result === null ? rows : rows.filter((r) => r.count > 0);

    for (const { rule, count } of visible) {
      const expanded = this.expandedRuleIds.has(rule.id);
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
      if (this.expandedRuleIds.has(rule.id)) {
        this.expandedRuleIds.delete(rule.id);
      } else {
        this.expandedRuleIds.add(rule.id);
      }
      this.render(this.currentResult);
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
          // Open the source note (not the [[target]]) — the user wants to
          // jump to the file that contains the broken link, not the missing
          // destination.
          void this.runAction("open", issue, { silent: true, rescan: false });
        });
      }
    }

    const actions = detail.createDiv({ cls: "vd-detail-actions" });

    const primary = actions.createEl("button", { cls: "vd-btn primary" });
    primary.appendText(`Fix all ${issues.length}`);
    primary.appendText(" ");
    primary.createSpan({ cls: "vd-kbd-mini", text: "⌘↵" });
    primary.addEventListener("click", () => {
      // "fix" is intentionally unimplemented in v1: route the click into
      // the dispatcher anyway so the day we ship a fixer the wiring is
      // already correct, and surface a friendly Notice in the meantime.
      void this.runAction("fix", issues, { rescan: false });
    });

    const showAllBtn = actions.createEl("button", {
      cls: "vd-btn",
      text: "Show all",
    });
    showAllBtn.addEventListener("click", () => {
      new ShowAllModal(this.app, rule, issues, {
        onAction: async (actionId, scope) => {
          await this.runAction(actionId, scope, { rescan: true });
        },
      }).open();
    });

    const whitelistBtn = actions.createEl("button", {
      cls: "vd-btn",
      text: "Whitelist",
    });
    whitelistBtn.addEventListener("click", () => {
      void this.runAction("whitelist", issues, { rescan: true });
    });
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
      if (!this.currentResult) {
        new Notice("Run a scan first");
        return;
      }
      new GuidedCleanupModal(
        this.app,
        this.plugin,
        this.currentResult,
      ).open();
    });
  }

  // -------------------------------------------------------------------------
  // Action plumbing
  // -------------------------------------------------------------------------

  /**
   * Single funnel for every dashboard click that routes to the action
   * dispatcher. Centralising this keeps the per-button handlers tiny and
   * guarantees consistent UX (Notice text, optional rescan, error fallback).
   *
   * @param actionId The action to execute.
   * @param scope Single issue or batch.
   * @param opts.rescan When true, re-runs the scan after a successful action
   *   so the dashboard reflects the new state.
   * @param opts.silent When true, suppresses the success Notice (used for
   *   navigation actions like `open`).
   */
  private async runAction(
    actionId: import("../types").ActionId,
    scope: Issue | Issue[],
    opts: { rescan?: boolean; silent?: boolean } = {},
  ): Promise<void> {
    try {
      const result = await this.plugin.actions.execute(actionId, scope);
      this.surfaceResult(actionId, result, opts.silent === true);
      if (opts.rescan === true && result.applied > 0) {
        void this.runScan();
      }
    } catch (err) {
      if (actionId === "fix") {
        new Notice(
          "Fix action coming soon — use Open or Whitelist for now",
        );
        return;
      }
      new Notice(`Action failed: ${String(err)}`);
    }
  }

  /**
   * Translate an `ActionResult` into a user-visible Notice.
   *
   * - All applied → success.
   * - All skipped (likely cancelled confirmation) → silent.
   * - Mixed errors → partial-failure message with the count of failures.
   */
  private surfaceResult(
    actionId: import("../types").ActionId,
    result: ActionResult,
    silent: boolean,
  ): void {
    const total = result.applied + result.errors.length + result.skipped;
    if (total === 0) return;

    if (result.applied === 0 && result.errors.length === 0) {
      // User cancelled or nothing to do — no Notice needed.
      return;
    }

    if (silent && result.errors.length === 0) return;

    const verb = pastTenseFor(actionId);

    if (result.errors.length === 0) {
      new Notice(`${verb} ${result.applied} ${noun(result.applied)}`);
      return;
    }

    if (result.applied === 0) {
      new Notice(
        `${capitalize(actionId)} failed for all ${result.errors.length} ${noun(result.errors.length)}`,
      );
      console.error("[Vault Doctor] action errors", result.errors);
      return;
    }

    new Notice(
      `${verb} ${result.applied} ${noun(result.applied)}, ${result.errors.length} failed`,
    );
    console.error("[Vault Doctor] partial action errors", result.errors);
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

function pastTenseFor(actionId: import("../types").ActionId): string {
  switch (actionId) {
    case "archive":
      return "Archived";
    case "delete":
      return "Trashed";
    case "whitelist":
      return "Whitelisted";
    case "open":
      return "Opened";
    case "fix":
      return "Fixed";
  }
}

function noun(count: number): string {
  return count === 1 ? "issue" : "issues";
}

function capitalize(value: string): string {
  if (value.length === 0) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
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
