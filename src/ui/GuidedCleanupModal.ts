import { Modal, Notice, type App } from "obsidian";
import type { ScanResult } from "../types";
import type { VaultDoctorPluginWithEngine } from "../engine";
import type { VaultDoctorPluginWithActions } from "../actions";

type CleanupPlugin = VaultDoctorPluginWithEngine & VaultDoctorPluginWithActions;

/**
 * Guided Cleanup wizard — walks the user through critical issues,
 * applying fixes one severity bucket at a time, with a final summary.
 * This is a placeholder; the real implementation is filled in by the
 * guided-cleanup agent.
 *
 * Public contract:
 *   new GuidedCleanupModal(app, plugin, scanResult).open()
 */
export class GuidedCleanupModal extends Modal {
  constructor(
    app: App,
    private readonly plugin: CleanupPlugin,
    private readonly scanResult: ScanResult,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Guided Cleanup" });
    const crit = this.scanResult.issues.filter(
      (i) => i.severity === "critical",
    );
    const warn = this.scanResult.issues.filter(
      (i) => i.severity === "warning",
    );
    contentEl.createEl("p", {
      text: `Will walk through ${crit.length} critical and ${warn.length} warning issues. Wizard implementation coming.`,
    });
    void this.plugin;
    void Notice;
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
