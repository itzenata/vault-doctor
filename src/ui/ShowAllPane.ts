import { type App } from "obsidian";
import type { Issue, Rule } from "../types";

/**
 * "Show all" sub-view — full list of issues for a single rule, with bulk
 * action affordances (search, multi-select, whitelist/archive). Renders
 * INSIDE the Vault Doctor pane (not as a floating modal) so the user
 * stays in the same conceptual surface.
 *
 * Public contract:
 *   const pane = new ShowAllPane(app, rule, issues, opts);
 *   pane.render(parentEl);
 *   // ...later, when navigating away:
 *   pane.dispose();
 *
 * opts.onAction(actionId, scope) — called when the user picks a bulk action
 *   ("archive" | "whitelist" | "open"). The dashboard re-runs a scan after a
 *   successful one. "delete" is intentionally NOT exposed here — bulk delete
 *   is too destructive; users delete per-issue via the dashboard's existing
 *   confirmation flow.
 *
 * opts.onDone — called after a successful bulk action so the host can
 *   navigate back to the dashboard view.
 */
export interface ShowAllPaneOptions {
  onAction?: (
    actionId: "archive" | "delete" | "whitelist" | "open",
    scope: Issue[],
  ) => Promise<void>;
  onDone?: () => void;
}

interface IssueEntry {
  issue: Issue;
  /** Stable identity key — issues from the same note path with different
   *  contexts can collide on path alone, so we hash path+message+target. */
  key: string;
  /** Lowercased haystack precomputed once; search just substring-matches. */
  haystack: string;
  /** Short context label derived from the issue (e.g., target path). */
  context: string;
}

const SEARCH_DEBOUNCE_MS = 120;

export class ShowAllPane {
  private readonly entries: IssueEntry[];
  private readonly selected = new Set<string>();
  private filteredKeys: string[] = [];
  private searchQuery = "";
  private searchDebounce: number | null = null;
  private disposed = false;

  // Live element handles, populated in render().
  private rootEl: HTMLElement | null = null;
  private searchInputEl: HTMLInputElement | null = null;
  private toggleAllBtnEl: HTMLButtonElement | null = null;
  private selectionCountEl: HTMLElement | null = null;
  private tableEl: HTMLElement | null = null;
  private emptyStateEl: HTMLElement | null = null;
  private whitelistBtnEl: HTMLButtonElement | null = null;
  private archiveBtnEl: HTMLButtonElement | null = null;

  constructor(
    private readonly app: App,
    private readonly rule: Rule,
    private readonly issues: Issue[],
    private readonly opts: ShowAllPaneOptions = {},
  ) {
    this.entries = issues.map((issue, idx) => {
      const target = issue.context?.targetPath ?? "";
      const key = hashKey(
        `${idx}|${issue.notePath}|${issue.message}|${target}`,
      );
      const context = deriveContext(issue);
      return {
        issue,
        key,
        context,
        haystack: `${issue.notePath}\n${issue.message}\n${context}`.toLowerCase(),
      };
    });
    this.filteredKeys = this.entries.map((e) => e.key);
  }

  render(parent: HTMLElement): void {
    parent.empty();
    const root = parent.createDiv({ cls: "vd-sa-root" });
    this.rootEl = root;

    this.renderSubtitle(root);
    this.renderSearch(root);
    this.renderToolbar(root);
    this.renderTableShell(root);
    this.renderActionBar(root);

    this.applyFilter();

    // Focus the search input on open for fast keyboard triage.
    this.searchInputEl?.focus();
  }

  /**
   * Releases timers and clears element references. Must be called when the
   * host navigates away — otherwise a pending debounced search timer can
   * fire after the pane has been re-rendered to a different view, calling
   * applyFilter() against a detached DOM tree.
   */
  dispose(): void {
    this.disposed = true;
    if (this.searchDebounce !== null) {
      window.clearTimeout(this.searchDebounce);
      this.searchDebounce = null;
    }
    this.rootEl = null;
    this.searchInputEl = null;
    this.toggleAllBtnEl = null;
    this.selectionCountEl = null;
    this.tableEl = null;
    this.emptyStateEl = null;
    this.whitelistBtnEl = null;
    this.archiveBtnEl = null;
  }

  // ---------------------------------------------------------------------------
  // Subtitle (issue count + severity chip — the rule name lives in the
  // breadcrumb, so we don't duplicate it here)
  // ---------------------------------------------------------------------------
  private renderSubtitle(parent: HTMLElement): void {
    const header = parent.createDiv({ cls: "vd-sa-header" });
    const sub = header.createDiv({ cls: "vd-sa-subtitle" });
    const n = this.issues.length;
    sub.appendText(`${n} issue${n === 1 ? "" : "s"} · severity: `);
    sub.createSpan({
      cls: `vd-sa-sev vd-sa-sev-${this.rule.severity}`,
      text: this.rule.severity,
    });
  }

  // ---------------------------------------------------------------------------
  // Search bar (debounced)
  // ---------------------------------------------------------------------------
  private renderSearch(parent: HTMLElement): void {
    const wrap = parent.createDiv({ cls: "vd-sa-search" });
    const input = wrap.createEl("input", {
      cls: "vd-sa-search-input",
      type: "text",
      attr: {
        placeholder: "Search by path or message…",
        spellcheck: "false",
        autocomplete: "off",
      },
    });
    this.searchInputEl = input;
    input.addEventListener("input", () => {
      if (this.searchDebounce !== null) {
        window.clearTimeout(this.searchDebounce);
      }
      this.searchDebounce = window.setTimeout(() => {
        this.searchDebounce = null;
        if (this.disposed) return;
        this.searchQuery = input.value.trim().toLowerCase();
        this.applyFilter();
      }, SEARCH_DEBOUNCE_MS);
    });
  }

  // ---------------------------------------------------------------------------
  // Toolbar (select all visible / counter)
  // ---------------------------------------------------------------------------
  private renderToolbar(parent: HTMLElement): void {
    const bar = parent.createDiv({ cls: "vd-sa-toolbar" });

    const left = bar.createDiv({ cls: "vd-sa-toolbar-left" });
    const toggleBtn = left.createEl("button", {
      cls: "vd-btn",
      text: "Select all visible",
    });
    this.toggleAllBtnEl = toggleBtn;
    toggleBtn.addEventListener("click", () => {
      this.toggleSelectAllVisible();
    });

    const right = bar.createDiv({ cls: "vd-sa-toolbar-right" });
    this.selectionCountEl = right.createSpan({
      cls: "vd-sa-count",
      text: "0 selected",
    });
  }

  // ---------------------------------------------------------------------------
  // Scrollable table
  // ---------------------------------------------------------------------------
  private renderTableShell(parent: HTMLElement): void {
    this.tableEl = parent.createDiv({ cls: "vd-sa-table" });
    this.emptyStateEl = parent.createDiv({
      cls: "vd-sa-empty",
      text: "No issues to show",
    });
    this.emptyStateEl.style.display = "none";
  }

  private rebuildTable(): void {
    const table = this.tableEl;
    if (table === null) return;
    table.empty();

    if (this.entries.length === 0) {
      this.showEmpty("No issues to show");
      return;
    }

    if (this.filteredKeys.length === 0) {
      this.showEmpty("No matches");
      return;
    }

    this.hideEmpty();

    // Build a quick lookup for filtered entries, in original order.
    const filteredSet = new Set(this.filteredKeys);
    for (const entry of this.entries) {
      if (!filteredSet.has(entry.key)) continue;
      table.appendChild(this.buildRow(entry));
    }
  }

  private buildRow(entry: IssueEntry): HTMLElement {
    // Stack vertically for narrow sidebar pane: path on top, context below,
    // checkbox on the left, "Open" link on the right.
    const row = createDiv({ cls: "vd-sa-row" });
    if (this.selected.has(entry.key)) {
      row.addClass("is-selected");
    }

    // Checkbox
    const checkboxWrap = row.createDiv({ cls: "vd-sa-row-check" });
    const checkbox = checkboxWrap.createEl("input", {
      type: "checkbox",
      cls: "vd-sa-checkbox",
    });
    checkbox.checked = this.selected.has(entry.key);
    checkbox.addEventListener("click", (ev) => {
      ev.stopPropagation();
    });
    checkbox.addEventListener("change", () => {
      this.setSelected(entry.key, checkbox.checked);
      row.toggleClass("is-selected", checkbox.checked);
    });

    // Stacked text column: path on top, context below.
    const textCol = row.createDiv({ cls: "vd-sa-row-text" });
    const path = textCol.createDiv({
      cls: "vd-sa-row-path",
      text: entry.issue.notePath,
    });
    path.setAttr("title", entry.issue.notePath);
    const ctx = textCol.createDiv({
      cls: "vd-sa-row-ctx",
      text: entry.context,
    });
    if (entry.context !== "") {
      ctx.setAttr("title", entry.issue.message);
    }

    // Open link (single-issue, doesn't touch selection)
    const open = row.createEl("a", {
      cls: "vd-sa-row-open",
      text: "Open",
      attr: { href: "#" },
    });
    open.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.handleOpen(entry.issue);
    });

    // Clicking anywhere else on the row toggles selection — quality of life
    // when triaging large lists, mirrors how Linear behaves.
    row.addEventListener("click", () => {
      const next = !this.selected.has(entry.key);
      checkbox.checked = next;
      this.setSelected(entry.key, next);
      row.toggleClass("is-selected", next);
    });

    return row;
  }

  // ---------------------------------------------------------------------------
  // Action bar (sticky at the bottom of the pane)
  // ---------------------------------------------------------------------------
  private renderActionBar(parent: HTMLElement): void {
    const bar = parent.createDiv({ cls: "vd-sa-actions" });

    const spacer = bar.createDiv({ cls: "vd-sa-actions-spacer" });
    void spacer;

    const whitelist = bar.createEl("button", {
      cls: "vd-btn",
      text: "Whitelist 0",
    });
    this.whitelistBtnEl = whitelist;
    whitelist.disabled = true;
    whitelist.addEventListener("click", () => {
      void this.dispatch("whitelist");
    });

    const archive = bar.createEl("button", {
      cls: "vd-btn primary",
      text: "Archive 0",
    });
    this.archiveBtnEl = archive;
    archive.disabled = true;
    archive.addEventListener("click", () => {
      void this.dispatch("archive");
    });
  }

  // ---------------------------------------------------------------------------
  // State mutations
  // ---------------------------------------------------------------------------
  private applyFilter(): void {
    const q = this.searchQuery;
    if (q === "") {
      this.filteredKeys = this.entries.map((e) => e.key);
    } else {
      this.filteredKeys = this.entries
        .filter((e) => e.haystack.includes(q))
        .map((e) => e.key);
    }
    // Drop any selections that fall outside the visible filter — the action
    // counters always reflect what the user can actually see.
    const visible = new Set(this.filteredKeys);
    for (const k of [...this.selected]) {
      if (!visible.has(k)) this.selected.delete(k);
    }
    this.rebuildTable();
    this.updateSelectionUi();
  }

  private setSelected(key: string, on: boolean): void {
    if (on) this.selected.add(key);
    else this.selected.delete(key);
    this.updateSelectionUi();
  }

  private toggleSelectAllVisible(): void {
    const allSelected = this.allVisibleSelected();
    if (allSelected) {
      for (const k of this.filteredKeys) this.selected.delete(k);
    } else {
      for (const k of this.filteredKeys) this.selected.add(k);
    }
    // Re-render the table to sync each checkbox; cheap enough at MVP scale.
    this.rebuildTable();
    this.updateSelectionUi();
  }

  private allVisibleSelected(): boolean {
    if (this.filteredKeys.length === 0) return false;
    for (const k of this.filteredKeys) {
      if (!this.selected.has(k)) return false;
    }
    return true;
  }

  private updateSelectionUi(): void {
    const n = this.selected.size;
    if (this.selectionCountEl !== null) {
      this.selectionCountEl.setText(`${n} selected`);
    }
    if (this.toggleAllBtnEl !== null) {
      this.toggleAllBtnEl.setText(
        this.allVisibleSelected() && this.filteredKeys.length > 0
          ? "Deselect all visible"
          : "Select all visible",
      );
    }
    const hasDispatcher = this.opts.onAction !== undefined;
    const enable = n > 0 && hasDispatcher;
    if (this.whitelistBtnEl !== null) {
      this.whitelistBtnEl.disabled = !enable;
      this.whitelistBtnEl.setText(`Whitelist ${n}`);
    }
    if (this.archiveBtnEl !== null) {
      this.archiveBtnEl.disabled = !enable;
      this.archiveBtnEl.setText(`Archive ${n}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Action dispatch
  // ---------------------------------------------------------------------------
  private async dispatch(actionId: "archive" | "whitelist"): Promise<void> {
    const scope = this.collectSelectedIssues();
    if (scope.length === 0) return;
    const handler = this.opts.onAction;
    if (handler === undefined) return;

    // Best-effort guard against double-clicks during the await.
    if (this.archiveBtnEl !== null) this.archiveBtnEl.disabled = true;
    if (this.whitelistBtnEl !== null) this.whitelistBtnEl.disabled = true;

    try {
      await handler(actionId, scope);
    } finally {
      // Hand back control to the host: the dashboard will navigate away
      // (and a rescan will produce a fresh issue list anyway).
      this.opts.onDone?.();
    }
  }

  private handleOpen(issue: Issue): void {
    const handler = this.opts.onAction;
    if (handler !== undefined) {
      // Fire-and-forget; "open" doesn't gate any UI mutation here.
      void handler("open", [issue]);
      return;
    }
    // Fallback when no dispatcher: open the note directly.
    void this.app.workspace.openLinkText(issue.notePath, "");
  }

  private collectSelectedIssues(): Issue[] {
    const byKey = new Map(this.entries.map((e) => [e.key, e.issue]));
    const out: Issue[] = [];
    for (const k of this.selected) {
      const i = byKey.get(k);
      if (i !== undefined) out.push(i);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Empty-state plumbing
  // ---------------------------------------------------------------------------
  private showEmpty(text: string): void {
    if (this.tableEl !== null) this.tableEl.style.display = "none";
    if (this.emptyStateEl !== null) {
      this.emptyStateEl.style.display = "";
      this.emptyStateEl.setText(text);
    }
  }

  private hideEmpty(): void {
    if (this.tableEl !== null) this.tableEl.style.display = "";
    if (this.emptyStateEl !== null) this.emptyStateEl.style.display = "none";
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Derive a short context label from an issue. We prefer the explicit
 * `context.targetPath` (broken-link rules set this), then fall back to a
 * trimmed message — but never the full path again, since that's already
 * displayed in its own column.
 */
function deriveContext(issue: Issue): string {
  const target = issue.context?.targetPath;
  if (typeof target === "string" && target.length > 0) {
    return `[[${target}]]`;
  }
  const msg = issue.message ?? "";
  if (msg === "") return "";
  // If the message starts with the note path, strip it — redundant.
  const trimmed =
    msg.startsWith(issue.notePath) && msg.length > issue.notePath.length
      ? msg.slice(issue.notePath.length).replace(/^[\s:—-]+/, "")
      : msg;
  // Cap to keep rows compact.
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
}

/**
 * Tiny non-cryptographic string hash (FNV-1a-ish) for stable row keys.
 * Avoids collisions when the same notePath appears with multiple contexts,
 * without pulling in a hashing dep.
 */
function hashKey(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Unsigned hex; prefix for debuggability.
  return `k${(h >>> 0).toString(16)}`;
}
