import type { Plugin, WorkspaceLeaf } from "obsidian";
import type { VaultDoctorPluginWithEngine } from "../engine";
import { DashboardView } from "./DashboardView";

// Public contract used by main.ts:
//   registerUI(plugin) — registers the view type, ribbon icon, and commands
export async function registerUI(plugin: Plugin): Promise<void> {
  plugin.registerView(
    DashboardView.VIEW_TYPE,
    (leaf: WorkspaceLeaf) =>
      new DashboardView(leaf, plugin as VaultDoctorPluginWithEngine),
  );

  plugin.addRibbonIcon("stethoscope", "Open Vault Doctor", () => {
    void activateView(plugin);
  });

  plugin.addCommand({
    id: "vault-doctor:open-dashboard",
    name: "Vault Doctor: Open dashboard",
    callback: () => {
      void activateView(plugin);
    },
  });

  // Detach all dashboard leaves on plugin unload.
  plugin.register(() => {
    plugin.app.workspace.detachLeavesOfType(DashboardView.VIEW_TYPE);
  });
}

/**
 * Reveal the dashboard view in the right sidebar, creating a new leaf if none
 * exists yet.
 */
async function activateView(plugin: Plugin): Promise<void> {
  const { workspace } = plugin.app;

  const existing = workspace.getLeavesOfType(DashboardView.VIEW_TYPE);
  if (existing.length > 0) {
    await workspace.revealLeaf(existing[0]);
    return;
  }

  const leaf = workspace.getRightLeaf(false);
  if (!leaf) return;

  await leaf.setViewState({
    type: DashboardView.VIEW_TYPE,
    active: true,
  });
  await workspace.revealLeaf(leaf);
}
