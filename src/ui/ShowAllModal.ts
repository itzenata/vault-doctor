import { Modal, Notice, type App } from "obsidian";
import type { Issue, Rule } from "../types";

/**
 * "Show all" modal — full list of issues for a single rule, with bulk
 * action affordances. This is a placeholder; the real implementation
 * is filled in by the show-all agent.
 *
 * Public contract:
 *   new ShowAllModal(app, rule, issues, opts).open()
 *   opts.onAction(actionId, scope) — called when the user picks a bulk action;
 *     the dashboard re-runs a scan after a successful one.
 */
export interface ShowAllModalOptions {
  onAction?: (
    actionId: "archive" | "delete" | "whitelist" | "open",
    scope: Issue[],
  ) => Promise<void>;
}

export class ShowAllModal extends Modal {
  constructor(
    app: App,
    private readonly rule: Rule,
    private readonly issues: Issue[],
    private readonly opts: ShowAllModalOptions = {},
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.rule.name });
    contentEl.createEl("p", {
      text: `${this.issues.length} issue${this.issues.length === 1 ? "" : "s"} — full list view coming.`,
    });
    // Quick stub so the user gets something useful immediately.
    const list = contentEl.createEl("ul");
    for (const issue of this.issues.slice(0, 50)) {
      list.createEl("li", { text: issue.notePath });
    }
    if (this.issues.length > 50) {
      contentEl.createEl("p", {
        text: `…and ${this.issues.length - 50} more.`,
      });
    }
    void this.opts; // silence unused; the real impl will use it
    void Notice; // imported for the agent's expected dispatch flow
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
