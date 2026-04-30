// Vault Doctor — engine entry point.
//
// `registerEngine(plugin)` is the only public surface main.ts depends on.
// It wires:
//   1. a Scanner instance attached to the plugin (accessible via .scanner)
//   2. the "Vault Doctor: Run scan" command, which executes a scan and
//      surfaces a Notice + console log with the result.

import { Notice, type Plugin } from "obsidian";
import type { ScanResult } from "../types";
import { Scanner } from "./scanner";

export { Scanner } from "./scanner";
export { computeScore } from "./scoring";
export { parseLinks } from "./linkParser";

/**
 * Plugin instances augmented by the engine carry a `scanner` field. We keep
 * this as a structural type rather than mutating the plugin's class declaration
 * so we don't need to touch main.ts.
 */
export interface VaultDoctorPluginWithEngine extends Plugin {
  scanner: Scanner;
}

export async function registerEngine(plugin: Plugin): Promise<void> {
  const scanner = new Scanner(plugin);
  (plugin as VaultDoctorPluginWithEngine).scanner = scanner;

  plugin.addCommand({
    id: "vault-doctor:run-scan",
    name: "Vault Doctor: Run scan",
    callback: async () => {
      const result: ScanResult = await scanner.scan();
      new Notice(
        `Vault score: ${result.score} · ${result.issues.length} issues`,
      );
      console.log("[Vault Doctor] scan result", result);
    },
  });
}
