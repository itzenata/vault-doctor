import { Plugin } from "obsidian";
import { registerEngine } from "./src/engine";
import { registerUI } from "./src/ui";

export default class VaultDoctorPlugin extends Plugin {
  async onload(): Promise<void> {
    await registerEngine(this);
    await registerUI(this);
    console.log("[Vault Doctor] loaded");
  }

  onunload(): void {
    console.log("[Vault Doctor] unloaded");
  }
}
