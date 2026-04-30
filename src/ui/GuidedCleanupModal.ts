import { Modal, Notice, type App } from "obsidian";
import type { ActionId, Issue, Rule, ScanResult, Severity } from "../types";
import type { VaultDoctorPluginWithEngine } from "../engine";
import type {
  ActionResult,
  VaultDoctorPluginWithActions,
} from "../actions";
import { ALL_RULES } from "../rules";

type CleanupPlugin = VaultDoctorPluginWithEngine & VaultDoctorPluginWithActions;

/**
 * Action choices the wizard offers per rule. Intentionally a strict subset of
 * `ActionId` — destructive ops (`delete`, interactive `fix`, navigation `open`)
 * are excluded from the bulk guided flow. Users who need them go through the
 * regular dashboard row.
 */
type WizardAction = "skip" | "whitelist" | "archive";

const WIZARD_ACTION_LABEL: Record<WizardAction, string> = {
  skip: "Skip",
  whitelist: "Whitelist",
  archive: "Archive",
};

/**
 * Default wizard action per rule id. Anything not listed defaults to "skip"
 * so rules added in parallel branches stay safe.
 *
 * - BROKEN-LINK / BROKEN-EMBED → whitelist (less disruptive than auto-fix)
 * - ORPHAN-NOTE / EMPTY-NOTE / ORPHAN-ATTACHMENT → archive (recoverable)
 * - OVERSIZED-NOTE / STALE-NOTE / DAILY-GAP → skip (judgement calls)
 */
const DEFAULT_ACTION_BY_RULE: Record<string, WizardAction> = {
  "BROKEN-LINK": "whitelist",
  "BROKEN-EMBED": "whitelist",
  "ORPHAN-NOTE": "archive",
  "EMPTY-NOTE": "archive",
  "ORPHAN-ATTACHMENT": "archive",
  "OVERSIZED-NOTE": "skip",
  "STALE-NOTE": "skip",
  "DAILY-GAP": "skip",
};

const SEVERITY_MULTIPLIER: Record<Severity, number> = {
  critical: 3.0,
  warning: 1.5,
  info: 0.5,
};

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
};

const SEVERITY_ORDER: Severity[] = ["critical", "warning", "info"];

interface RuleEntry {
  rule: Rule;
  count: number;
  action: WizardAction;
}

/**
 * Guided Cleanup wizard — single-pane "review and apply" flow.
 *
 * Groups issues by severity, lets the user pick `Skip | Whitelist | Archive`
 * per rule, projects the post-cleanup score, then dispatches every non-skip
 * batch through `plugin.actions.execute`. One Notice per phase; per-issue
 * errors aggregate into the final summary.
 *
 * Public contract:
 *   new GuidedCleanupModal(app, plugin, scanResult).open()
 */
export class GuidedCleanupModal extends Modal {
  private readonly plugin: CleanupPlugin;
  private readonly scanResult: ScanResult;
  private readonly entries: RuleEntry[];
  private readonly issuesByRule: Map<string, Issue[]>;
  private readonly collapsed: Set<Severity>;
  private isApplying = false;
  private applyButton: HTMLButtonElement | null = null;
  private cancelButton: HTMLButtonElement | null = null;
  private summaryEl: HTMLElement | null = null;

  constructor(
    app: App,
    plugin: VaultDoctorPluginWithEngine & VaultDoctorPluginWithActions,
    scanResult: ScanResult,
  ) {
    super(app);
    this.plugin = plugin;
    this.scanResult = scanResult;

    // Bucket issues by ruleId once. We reuse this map both for per-row counts
    // and for the actual apply dispatch (no second pass over the issue list).
    this.issuesByRule = new Map<string, Issue[]>();
    for (const issue of scanResult.issues) {
      const list = this.issuesByRule.get(issue.ruleId);
      if (list === undefined) {
        this.issuesByRule.set(issue.ruleId, [issue]);
      } else {
        list.push(issue);
      }
    }

    // Build the entry list in registry order so the UI stays stable across
    // scans. Drop rules with zero issues — nothing to clean.
    this.entries = ALL_RULES.filter(
      (rule) => (this.issuesByRule.get(rule.id)?.length ?? 0) > 0,
    ).map((rule) => ({
      rule,
      count: this.issuesByRule.get(rule.id)?.length ?? 0,
      action: DEFAULT_ACTION_BY_RULE[rule.id] ?? "skip",
    }));

    // Info collapsed by default; Critical/Warning expanded if they have rows.
    this.collapsed = new Set<Severity>(["info"]);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("vault-doctor-cleanup");
    this.modalEl.addClass("mod-wide");

    if (this.scanResult.issues.length === 0) {
      this.renderEmpty(contentEl);
      return;
    }

    this.renderHeader(contentEl);
    this.renderSeveritySections(contentEl);
    this.renderSummary(contentEl);
    this.renderActions(contentEl);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private renderEmpty(parent: HTMLElement): void {
    parent.createEl("h2", { text: "Guided Cleanup" });
    parent.createEl("p", {
      cls: "vd-gc-empty",
      text: "Nothing to clean up — vault is healthy.",
    });
    const bar = parent.createDiv({ cls: "vd-gc-actions" });
    const closeBtn = bar.createEl("button", {
      cls: "vd-gc-btn primary",
      text: "Close",
    });
    closeBtn.addEventListener("click", () => this.close());
  }

  private renderHeader(parent: HTMLElement): void {
    parent.createEl("h2", { text: "Guided Cleanup" });

    const counts = countBySeverity(this.scanResult.issues);
    const subtitle = parent.createDiv({ cls: "vd-gc-subtitle" });
    subtitle.appendText(
      `${counts.critical} critical, ${counts.warning} warning, ${counts.info} info issues`,
    );
  }

  private renderSeveritySections(parent: HTMLElement): void {
    for (const severity of SEVERITY_ORDER) {
      const sevEntries = this.entries.filter(
        (e) => e.rule.severity === severity,
      );
      if (sevEntries.length === 0) continue;
      this.renderSeveritySection(parent, severity, sevEntries);
    }
  }

  private renderSeveritySection(
    parent: HTMLElement,
    severity: Severity,
    entries: RuleEntry[],
  ): void {
    const section = parent.createDiv({
      cls: `vd-gc-section vd-gc-section-${severity}`,
    });

    const header = section.createDiv({ cls: "vd-gc-section-header" });

    const dot = header.createSpan({ cls: `vd-gc-section-dot ${severity}` });
    void dot;

    header.createSpan({
      cls: "vd-gc-section-label",
      text: SEVERITY_LABEL[severity],
    });

    const totalIssues = entries.reduce((sum, e) => sum + e.count, 0);
    header.createSpan({
      cls: "vd-gc-section-count",
      text: `${totalIssues} ${totalIssues === 1 ? "issue" : "issues"}`,
    });

    header.createSpan({ cls: "vd-gc-spacer" });

    const chevron = header.createSpan({ cls: "vd-gc-chevron" });
    const isCollapsed = this.collapsed.has(severity);
    chevron.setText(isCollapsed ? "›" : "⌄");

    const body = section.createDiv({ cls: "vd-gc-section-body" });
    if (isCollapsed) body.addClass("hidden");

    for (const entry of entries) {
      this.renderRuleRow(body, entry);
    }

    header.addEventListener("click", () => {
      if (this.isApplying) return;
      if (this.collapsed.has(severity)) {
        this.collapsed.delete(severity);
        body.removeClass("hidden");
        chevron.setText("⌄");
      } else {
        this.collapsed.add(severity);
        body.addClass("hidden");
        chevron.setText("›");
      }
    });
  }

  private renderRuleRow(parent: HTMLElement, entry: RuleEntry): void {
    const row = parent.createDiv({ cls: "vd-gc-rule-row" });

    const meta = row.createDiv({ cls: "vd-gc-rule-meta" });
    meta.createSpan({ cls: "vd-gc-rule-name", text: entry.rule.name });
    meta.createSpan({
      cls: "vd-gc-rule-id",
      text: entry.rule.id,
    });

    const select = row.createEl("select", { cls: "vd-gc-action-select" });
    const choices: WizardAction[] = ["skip", "whitelist", "archive"];
    for (const choice of choices) {
      const opt = select.createEl("option", {
        text: WIZARD_ACTION_LABEL[choice],
      });
      opt.value = choice;
      if (choice === entry.action) opt.selected = true;
    }
    select.addEventListener("change", () => {
      const next = select.value;
      if (next === "skip" || next === "whitelist" || next === "archive") {
        entry.action = next;
        this.refreshSummary();
      }
    });

    row.createSpan({
      cls: "vd-gc-rule-count",
      text: `(${entry.count} ${entry.count === 1 ? "issue" : "issues"})`,
    });
  }

  private renderSummary(parent: HTMLElement): void {
    this.summaryEl = parent.createDiv({ cls: "vd-gc-summary" });
    this.refreshSummary();
  }

  private refreshSummary(): void {
    if (this.summaryEl === null) return;
    this.summaryEl.empty();

    const active = this.entries.filter((e) => e.action !== "skip");
    const actionCount = active.length;
    const issueCount = active.reduce((sum, e) => sum + e.count, 0);
    const projected = this.projectScore(active);
    const currentScore = Math.round(this.scanResult.score);

    this.summaryEl.appendText(
      `Will apply ${actionCount} ${actionCount === 1 ? "action" : "actions"} across ${issueCount} ${issueCount === 1 ? "issue" : "issues"}. `,
    );
    this.summaryEl.appendText(`Estimated score after: `);
    const scoreSpan = this.summaryEl.createSpan({
      cls: "vd-gc-summary-score",
      text: String(projected),
    });
    if (projected > currentScore) scoreSpan.addClass("gain");

    if (this.applyButton !== null) {
      this.applyButton.disabled = actionCount === 0 || this.isApplying;
      this.applyButton.empty();
      this.applyButton.appendText(
        `Apply ${actionCount} ${actionCount === 1 ? "change" : "changes"}`,
      );
    }
  }

  /**
   * Projected score after removing the issues for every rule with action
   * ≠ skip. Mirrors the engine's penalty formula:
   *   score = 100 - Σ weight × multiplier × ln(count + 1)
   * We rebuild the penalty sum from the surviving rules rather than mutating
   * the engine state.
   */
  private projectScore(active: RuleEntry[]): number {
    const removed = new Set<string>(active.map((e) => e.rule.id));

    // Group counts for rules that will still emit issues post-cleanup.
    const remainingCounts = new Map<string, number>();
    for (const issue of this.scanResult.issues) {
      if (removed.has(issue.ruleId)) continue;
      remainingCounts.set(
        issue.ruleId,
        (remainingCounts.get(issue.ruleId) ?? 0) + 1,
      );
    }

    const ruleById = new Map<string, Rule>();
    for (const rule of ALL_RULES) ruleById.set(rule.id, rule);

    let penalty = 0;
    for (const [ruleId, count] of remainingCounts) {
      const rule = ruleById.get(ruleId);
      if (rule === undefined) continue;
      const multiplier = SEVERITY_MULTIPLIER[rule.severity];
      penalty += rule.weight * multiplier * Math.log(count + 1);
    }

    const raw = 100 - penalty;
    const clamped = Math.max(0, Math.min(100, raw));
    return Math.round(clamped);
  }

  private renderActions(parent: HTMLElement): void {
    const bar = parent.createDiv({ cls: "vd-gc-actions" });

    const cancel = bar.createEl("button", {
      cls: "vd-gc-btn",
      text: "Cancel",
    });
    cancel.addEventListener("click", () => {
      if (this.isApplying) return;
      this.close();
    });
    this.cancelButton = cancel;

    const apply = bar.createEl("button", {
      cls: "vd-gc-btn primary",
      text: "Apply 0 changes",
    });
    apply.addEventListener("click", () => {
      void this.applyAll();
    });
    this.applyButton = apply;
    // Recompute now that the button exists so its label/disabled state is
    // synced with the current selection (defaults can produce a non-zero
    // count out of the gate).
    this.refreshSummary();
  }

  // -------------------------------------------------------------------------
  // Apply phase
  // -------------------------------------------------------------------------

  private async applyAll(): Promise<void> {
    if (this.isApplying) return;
    const active = this.entries.filter((e) => e.action !== "skip");
    if (active.length === 0) return;

    this.isApplying = true;
    this.setApplyingState(true);

    new Notice("Applying cleanup...");

    let applied = 0;
    let skipped = 0;
    const errorMessages: string[] = [];

    for (const entry of active) {
      const issues = this.issuesByRule.get(entry.rule.id) ?? [];
      if (issues.length === 0) continue;
      const actionId = wizardActionToActionId(entry.action);
      if (actionId === null) continue;
      try {
        const result: ActionResult = await this.plugin.actions.execute(
          actionId,
          issues,
        );
        applied += result.applied;
        skipped += result.skipped;
        for (const err of result.errors) {
          errorMessages.push(`${entry.rule.id}: ${err.error}`);
        }
      } catch (err) {
        // The dispatcher swallows per-issue errors, but a programmer-error
        // throw (e.g. unknown action id) will still bubble. Don't abort the
        // whole batch; record and move on.
        errorMessages.push(`${entry.rule.id}: ${stringifyError(err)}`);
      }
    }

    const errors = errorMessages.length;
    new Notice(
      `Cleanup complete: ${applied} ${applied === 1 ? "action" : "actions"} applied, ${skipped} skipped, ${errors} ${errors === 1 ? "error" : "errors"}`,
    );
    if (errors > 0) {
      console.error("[Vault Doctor] guided cleanup errors", errorMessages);
    }

    this.isApplying = false;
    this.close();
  }

  private setApplyingState(applying: boolean): void {
    if (this.applyButton !== null) {
      this.applyButton.disabled = applying;
      if (applying) {
        this.applyButton.empty();
        this.applyButton.appendText("Applying…");
      }
    }
    if (this.cancelButton !== null) {
      this.cancelButton.disabled = applying;
    }
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function wizardActionToActionId(action: WizardAction): ActionId | null {
  switch (action) {
    case "archive":
      return "archive";
    case "whitelist":
      return "whitelist";
    case "skip":
      return null;
  }
}

function countBySeverity(issues: Issue[]): Record<Severity, number> {
  const counts: Record<Severity, number> = {
    critical: 0,
    warning: 0,
    info: 0,
  };
  for (const issue of issues) counts[issue.severity] += 1;
  return counts;
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
