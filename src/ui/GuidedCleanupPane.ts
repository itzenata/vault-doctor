import { Notice, type App } from "obsidian";
import type { ActionId, Issue, Rule, ScanResult, Severity } from "../types";
import type { VaultDoctorPluginWithEngine } from "../engine";
import type {
  ActionResult,
  VaultDoctorPluginWithActions,
} from "../actions";
import { ALL_RULES } from "../rules";

type CleanupPlugin = VaultDoctorPluginWithEngine & VaultDoctorPluginWithActions;

/**
 * Action choices the wizard offers per issue. `skip` is the no-op; the rest
 * map 1:1 onto `ActionId`. We expose the destructive `delete` and the
 * interactive `fix` here (PRD §8.2 calls for "preview, action en 1 clic ou
 * skip" — capping the wizard at non-destructive actions would force users
 * back to the dashboard for every critical issue).
 */
type WizardAction =
  | "skip"
  | "whitelist"
  | "archive"
  | "delete"
  | "fix"
  | "remove";

const WIZARD_ACTION_LABEL: Record<WizardAction, string> = {
  skip: "Skip",
  whitelist: "Whitelist",
  archive: "Archive",
  delete: "Delete",
  fix: "Fix (pick replacement)",
  remove: "Remove broken ref",
};

/**
 * Per-rule menu of action choices. Listed in the order they appear in the
 * dropdown. The first entry is the default; each rule below overrides it.
 *
 * Skip is always present so a user can opt out of a rule entirely without
 * deselecting individual issues.
 */
const ACTIONS_BY_RULE: Record<string, readonly WizardAction[]> = {
  // Default = `remove` for broken refs: a bulk "Apply" doesn't pile N
  // SuggestModals on top of the wizard. `fix` (interactive replacement)
  // remains available as an explicit override on a per-issue basis — the
  // user expands the row, picks Fix on that one, and only that one opens
  // the picker.
  "BROKEN-LINK": ["remove", "fix", "whitelist", "skip"],
  "BROKEN-EMBED": ["remove", "fix", "whitelist", "skip"],
  "DUPLICATE-EXACT": ["delete", "whitelist", "skip"],
  "ORPHAN-NOTE": ["archive", "delete", "whitelist", "skip"],
  "EMPTY-NOTE": ["archive", "delete", "whitelist", "skip"],
  "ORPHAN-ATTACHMENT": ["delete", "whitelist", "skip"],
  "TAG-INCONSISTENT": ["fix", "whitelist", "skip"],
  "OVERSIZED-NOTE": ["whitelist", "skip"],
  "STALE-NOTE": ["archive", "whitelist", "skip"],
  "DAILY-GAP": ["fix", "whitelist", "skip"],
};

const DEFAULT_FALLBACK: readonly WizardAction[] = ["skip"];

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
  issues: Issue[];
  /** Default action for newly-expanded issues + the bulk "set all" select. */
  bulkAction: WizardAction;
  /** Per-issue action overrides keyed by `issue.notePath`. */
  issueActions: Map<string, WizardAction>;
  /** Whether the issue list under this rule is expanded in the UI. */
  expanded: boolean;
}

export interface GuidedCleanupPaneOptions {
  /**
   * Called after Apply completes (success, partial, or no-op-from-empty).
   * The host uses this to navigate back to the dashboard and trigger a
   * rescan so the score and issue counts reflect the new vault state.
   */
  onDone?: () => void;
  /**
   * Called when the back button or onDone-style external trigger should be
   * disabled/enabled. The host wires this to its breadcrumb back-arrow so
   * the user can't navigate away mid-apply.
   */
  onApplyingChange?: (applying: boolean) => void;
}

/**
 * Guided Cleanup wizard — review-and-apply flow with per-issue control.
 *
 * Each rule row can be expanded to reveal its individual issues. The user
 * picks a default action for the rule (which fans out to every issue under
 * it) and can override on a per-issue basis. The Apply phase groups every
 * non-skip pair by `ActionId` and dispatches one batch per group.
 *
 * Renders INSIDE the Vault Doctor pane (no floating modal). The breadcrumb
 * back-arrow in the host serves as Cancel; we tell the host to disable it
 * during the apply phase via `opts.onApplyingChange`.
 */
export class GuidedCleanupPane {
  private readonly entries: RuleEntry[];
  private readonly collapsed: Set<Severity>;
  private isApplying = false;
  private applyButton: HTMLButtonElement | null = null;
  private summaryEl: HTMLElement | null = null;
  private rootEl: HTMLElement | null = null;

  constructor(
    private readonly app: App,
    private readonly plugin: CleanupPlugin,
    private readonly scanResult: ScanResult,
    private readonly opts: GuidedCleanupPaneOptions = {},
  ) {
    // Bucket issues by ruleId so each entry owns its issue list directly.
    const byRule = new Map<string, Issue[]>();
    for (const issue of scanResult.issues) {
      const list = byRule.get(issue.ruleId);
      if (list === undefined) byRule.set(issue.ruleId, [issue]);
      else list.push(issue);
    }

    // Build entries in registry order (stable across scans). Drop rules with
    // zero issues. Per-issue action map starts populated with the rule's
    // default so the apply phase doesn't need to fall back at dispatch time.
    this.entries = ALL_RULES.filter(
      (rule) => (byRule.get(rule.id)?.length ?? 0) > 0,
    ).map((rule) => {
      const issues = byRule.get(rule.id) ?? [];
      const choices = ACTIONS_BY_RULE[rule.id] ?? DEFAULT_FALLBACK;
      const bulkAction = choices[0];
      const issueActions = new Map<string, WizardAction>();
      for (const issue of issues) issueActions.set(issue.notePath, bulkAction);
      return { rule, issues, bulkAction, issueActions, expanded: false };
    });

    // Info collapsed by default; Critical/Warning expanded if they have rows.
    this.collapsed = new Set<Severity>(["info"]);
  }

  render(parent: HTMLElement): void {
    parent.empty();
    const root = parent.createDiv({ cls: "vd-gc-root" });
    this.rootEl = root;

    if (this.scanResult.issues.length === 0) {
      this.renderEmpty(root);
      return;
    }

    const scroll = root.createDiv({ cls: "vd-gc-scroll" });
    this.renderSubtitle(scroll);
    this.renderSeveritySections(scroll);
    this.renderSummary(scroll);
    this.renderActions(root);
  }

  /**
   * Releases element references. No timers to clear — the wizard's only
   * async work is the apply loop which checks `isApplying` before mutating
   * anything, and disposing while applying would be a host bug (the host
   * disables the back-arrow during apply, so the user can't navigate away).
   */
  dispose(): void {
    this.rootEl = null;
    this.applyButton = null;
    this.summaryEl = null;
  }

  /**
   * True while the apply loop is running. The host should consult this
   * before allowing back-navigation.
   */
  get applying(): boolean {
    return this.isApplying;
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private renderEmpty(parent: HTMLElement): void {
    parent.createEl("p", {
      cls: "vd-gc-empty",
      text: "Nothing to clean up — vault is healthy.",
    });
    const bar = parent.createDiv({ cls: "vd-gc-actions" });
    const closeBtn = bar.createEl("button", {
      cls: "vd-gc-btn primary",
      text: "Back to dashboard",
    });
    closeBtn.addEventListener("click", () => {
      this.opts.onDone?.();
    });
  }

  private renderSubtitle(parent: HTMLElement): void {
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

    const totalIssues = entries.reduce((sum, e) => sum + e.issues.length, 0);
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
    const rowWrap = parent.createDiv({ cls: "vd-gc-rule-wrap" });

    const row = rowWrap.createDiv({ cls: "vd-gc-rule-row" });

    // Expand chevron — clicking opens the per-issue list. Whole row is
    // clickable too, for forgiving hit area.
    const expander = row.createSpan({ cls: "vd-gc-rule-expand" });
    expander.setText(entry.expanded ? "⌄" : "›");

    const meta = row.createDiv({ cls: "vd-gc-rule-meta" });
    meta.createSpan({ cls: "vd-gc-rule-name", text: entry.rule.name });
    meta.createSpan({
      cls: "vd-gc-rule-id",
      text: entry.rule.id,
    });

    // Bulk-set selector: changing this fans out to every issue under the rule.
    const select = row.createEl("select", { cls: "vd-gc-action-select" });
    const choices = ACTIONS_BY_RULE[entry.rule.id] ?? DEFAULT_FALLBACK;
    for (const choice of choices) {
      const opt = select.createEl("option", {
        text: WIZARD_ACTION_LABEL[choice],
      });
      opt.value = choice;
      if (choice === entry.bulkAction) opt.selected = true;
    }
    select.addEventListener("click", (ev) => ev.stopPropagation());
    select.addEventListener("change", () => {
      const next = select.value as WizardAction;
      if (!isWizardAction(next)) return;
      entry.bulkAction = next;
      // Apply to every issue — explicit per-issue overrides will be
      // re-applied if the user changes individual selects below.
      for (const issue of entry.issues) {
        entry.issueActions.set(issue.notePath, next);
      }
      // Re-render the issue rows under this entry to reflect the new state.
      const issueListEl = rowWrap.querySelector(".vd-gc-issue-list");
      if (issueListEl instanceof HTMLElement) {
        issueListEl.empty();
        for (const issue of entry.issues) {
          this.renderIssueRow(issueListEl, entry, issue);
        }
      }
      this.refreshSummary();
    });

    row.createSpan({
      cls: "vd-gc-rule-count",
      text: `(${entry.issues.length} ${entry.issues.length === 1 ? "issue" : "issues"})`,
    });

    // Toggle issue list on row click (excluding clicks on the select).
    const issueList = rowWrap.createDiv({ cls: "vd-gc-issue-list" });
    if (!entry.expanded) issueList.addClass("hidden");
    for (const issue of entry.issues) {
      this.renderIssueRow(issueList, entry, issue);
    }

    const toggle = (): void => {
      if (this.isApplying) return;
      entry.expanded = !entry.expanded;
      expander.setText(entry.expanded ? "⌄" : "›");
      if (entry.expanded) issueList.removeClass("hidden");
      else issueList.addClass("hidden");
    };
    expander.addEventListener("click", (ev) => {
      ev.stopPropagation();
      toggle();
    });
    row.addEventListener("click", (ev) => {
      const target = ev.target as HTMLElement;
      // Don't toggle when the click landed on an interactive control.
      if (target.closest(".vd-gc-action-select") !== null) return;
      toggle();
    });
  }

  private renderIssueRow(
    parent: HTMLElement,
    entry: RuleEntry,
    issue: Issue,
  ): void {
    const row = parent.createDiv({ cls: "vd-gc-issue-row" });

    const select = row.createEl("select", { cls: "vd-gc-issue-select" });
    const choices = ACTIONS_BY_RULE[entry.rule.id] ?? DEFAULT_FALLBACK;
    const current = entry.issueActions.get(issue.notePath) ?? entry.bulkAction;
    for (const choice of choices) {
      const opt = select.createEl("option", {
        text: WIZARD_ACTION_LABEL[choice],
      });
      opt.value = choice;
      if (choice === current) opt.selected = true;
    }
    select.addEventListener("click", (ev) => ev.stopPropagation());
    select.addEventListener("change", () => {
      const next = select.value as WizardAction;
      if (!isWizardAction(next)) return;
      entry.issueActions.set(issue.notePath, next);
      this.refreshSummary();
    });

    const path = row.createSpan({ cls: "vd-gc-issue-path" });
    path.setText(issue.notePath);
    path.setAttr("title", issue.notePath);

    const open = row.createSpan({ cls: "vd-gc-issue-open", text: "›" });
    open.setAttr("title", "Open note");
    open.addEventListener("click", (ev) => {
      ev.stopPropagation();
      void this.app.workspace.openLinkText(issue.notePath, "");
    });
  }

  private renderSummary(parent: HTMLElement): void {
    this.summaryEl = parent.createDiv({ cls: "vd-gc-summary" });
    this.refreshSummary();
  }

  private refreshSummary(): void {
    if (this.summaryEl === null) return;
    this.summaryEl.empty();

    // Count active (non-skip) issue selections, NOT rule entries — the unit
    // of action is now per-issue.
    let activeIssueCount = 0;
    const skippedIssueIds = new Set<string>();
    for (const entry of this.entries) {
      for (const issue of entry.issues) {
        const action =
          entry.issueActions.get(issue.notePath) ?? entry.bulkAction;
        if (action === "skip") skippedIssueIds.add(issueKey(issue));
        else activeIssueCount += 1;
      }
    }

    const projected = this.projectScore(skippedIssueIds);
    const currentScore = Math.round(this.scanResult.score);

    this.summaryEl.appendText(
      `Will apply ${activeIssueCount} ${activeIssueCount === 1 ? "change" : "changes"}. `,
    );
    this.summaryEl.appendText(`Estimated score after: `);
    const scoreSpan = this.summaryEl.createSpan({
      cls: "vd-gc-summary-score",
      text: String(projected),
    });
    if (projected > currentScore) scoreSpan.addClass("gain");

    if (this.applyButton !== null) {
      this.applyButton.disabled = activeIssueCount === 0 || this.isApplying;
      this.applyButton.empty();
      this.applyButton.appendText(
        `Apply ${activeIssueCount} ${activeIssueCount === 1 ? "change" : "changes"}`,
      );
    }
  }

  /**
   * Projected score after the active selections are applied. Issues whose
   * action is `skip` remain in the count; everything else is subtracted.
   * Mirrors the engine's penalty formula:
   *   score = 100 - Σ weight × multiplier × ln(count + 1)
   */
  private projectScore(skippedIssueIds: Set<string>): number {
    const remainingCounts = new Map<string, number>();
    for (const issue of this.scanResult.issues) {
      if (!skippedIssueIds.has(issueKey(issue))) continue;
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

    // No Cancel button — the breadcrumb back-arrow in the host serves that
    // purpose. The host disables the back-arrow during apply via the
    // onApplyingChange callback.

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

    // Group every (issue, action) pair by ActionId. One batch per ActionId
    // means the dispatcher's confirmation modals (delete) and interactive
    // flows (fix) fire once per category, not once per issue.
    const byActionId = new Map<ActionId, Issue[]>();
    for (const entry of this.entries) {
      for (const issue of entry.issues) {
        const action =
          entry.issueActions.get(issue.notePath) ?? entry.bulkAction;
        const actionId = wizardActionToActionId(action);
        if (actionId === null) continue;
        const list = byActionId.get(actionId);
        if (list === undefined) byActionId.set(actionId, [issue]);
        else list.push(issue);
      }
    }

    if (byActionId.size === 0) return;

    this.isApplying = true;
    this.opts.onApplyingChange?.(true);
    this.setApplyingState(true);

    new Notice("Applying cleanup...");

    let applied = 0;
    let skipped = 0;
    const errorMessages: string[] = [];

    for (const [actionId, issues] of byActionId) {
      try {
        const result: ActionResult = await this.plugin.actions.execute(
          actionId,
          issues,
        );
        applied += result.applied;
        skipped += result.skipped;
        for (const err of result.errors) {
          errorMessages.push(`${actionId} on ${err.issue.notePath}: ${err.error}`);
        }
      } catch (err) {
        // The dispatcher swallows per-issue errors, but a programmer-error
        // throw (e.g. unknown action id) will still bubble. Don't abort the
        // whole batch; record and move on.
        errorMessages.push(`${actionId}: ${stringifyError(err)}`);
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
    this.opts.onApplyingChange?.(false);
    // Hand control back to the host so it can navigate to the dashboard
    // and trigger a rescan.
    this.opts.onDone?.();
  }

  private setApplyingState(applying: boolean): void {
    if (this.applyButton !== null) {
      this.applyButton.disabled = applying;
      if (applying) {
        this.applyButton.empty();
        this.applyButton.appendText("Applying…");
      }
    }
    // Disable the per-rule selects and section headers cosmetically by
    // tagging the root; CSS handles the visuals.
    if (this.rootEl !== null) {
      this.rootEl.toggleClass("is-applying", applying);
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
    case "delete":
      return "delete";
    case "fix":
      return "fix";
    case "remove":
      return "remove";
    case "skip":
      return null;
  }
}

function isWizardAction(value: string): value is WizardAction {
  return (
    value === "skip" ||
    value === "whitelist" ||
    value === "archive" ||
    value === "delete" ||
    value === "fix" ||
    value === "remove"
  );
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

/**
 * Stable identity for an issue across maps. `notePath` alone is not unique
 * (a note can have multiple issues from different rules) — pair it with
 * ruleId.
 */
function issueKey(issue: Issue): string {
  return `${issue.ruleId}::${issue.notePath}`;
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
