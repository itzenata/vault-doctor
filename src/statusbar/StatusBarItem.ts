import type { Plugin } from "obsidian";
import { setTooltip } from "obsidian";
import type { ScanResult } from "../types";

// View-type string for the dashboard. Duplicates DashboardView.VIEW_TYPE —
// kept here to avoid an import cycle with src/ui/.
const DASHBOARD_VIEW_TYPE = "vault-doctor-dashboard";

/**
 * Manages the persistent vault-score indicator rendered into the host element
 * returned by `Plugin.addStatusBarItem()`. The host element is owned by
 * Obsidian; we only manipulate its contents.
 */
export class StatusBarItem {
  private readonly plugin: Plugin;
  private readonly hostEl: HTMLElement;
  private readonly clickHandler: (evt: MouseEvent) => void;

  constructor(plugin: Plugin, hostEl: HTMLElement) {
    this.plugin = plugin;
    this.hostEl = hostEl;

    this.hostEl.addClass("vd-statusbar");
    this.clickHandler = (evt: MouseEvent): void => {
      evt.preventDefault();
      void this.openDashboard();
    };
    this.hostEl.addEventListener("click", this.clickHandler);
  }

  /**
   * Re-render the indicator. Pass `null` to show the empty state (no scan
   * yet); pass a `ScanResult` to show the live score.
   */
  update(result: ScanResult | null): void {
    this.hostEl.empty();

    const icon = this.hostEl.createSpan({
      cls: "vd-statusbar-icon",
      text: "🩺",
    });
    void icon;

    if (result === null) {
      const score = this.hostEl.createSpan({
        cls: "vd-statusbar-score",
        text: "—",
      });
      score.style.color = "var(--vd-text-muted, var(--text-muted))";
      this.hostEl.createSpan({ cls: "vd-statusbar-denom", text: "/100" });

      const tip = "Vault Doctor: no scan yet — click to open the dashboard";
      this.hostEl.setAttr("aria-label", tip);
      setTooltip(this.hostEl, tip);
      return;
    }

    const score = Math.round(result.score);
    const color = verdictColor(score);

    const scoreEl = this.hostEl.createSpan({
      cls: "vd-statusbar-score",
      text: String(score),
    });
    scoreEl.style.color = color;

    const issueCount = result.issues.length;
    const tip = `Vault score: ${score} · ${issueCount} issues · scanned ${result.noteCount} notes`;
    this.hostEl.setAttr("aria-label", tip);
    setTooltip(this.hostEl, tip);
  }

  /**
   * Detach listeners and clear the host. Obsidian removes the host element
   * itself when the plugin unloads, so we only need to undo what we added.
   */
  dispose(): void {
    this.hostEl.removeEventListener("click", this.clickHandler);
    this.hostEl.removeClass("vd-statusbar");
    this.hostEl.empty();
  }

  // ---------------------------------------------------------------------------

  private async openDashboard(): Promise<void> {
    const workspace = this.plugin.app.workspace;
    const leaves = workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE);
    if (leaves.length > 0) {
      workspace.revealLeaf(leaves[0]);
      return;
    }
    const leaf = workspace.getRightLeaf(false);
    if (leaf !== null) {
      await leaf.setViewState({ type: DASHBOARD_VIEW_TYPE, active: true });
      workspace.revealLeaf(leaf);
    }
  }
}

/**
 * Map a score to a CSS-variable color. Bands match DashboardView.verdictFor:
 *   90+ → green, 70+ → green, 50+ → orange, <50 → red.
 */
function verdictColor(score: number): string {
  if (score >= 90) return "var(--vd-good)";
  if (score >= 70) return "var(--vd-good)";
  if (score >= 50) return "var(--vd-orange)";
  return "var(--vd-critical)";
}
