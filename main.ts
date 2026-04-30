import { Plugin } from "obsidian";
import { registerEngine } from "./src/engine";
import { registerActions } from "./src/actions";
import { registerSettings } from "./src/settings";
import { registerUI } from "./src/ui";
import { registerStatusBar } from "./src/statusbar";

export default class VaultDoctorPlugin extends Plugin {
  async onload(): Promise<void> {
    await registerEngine(this);
    await registerActions(this);
    await registerSettings(this);
    await registerUI(this);
    await registerStatusBar(this);
    console.log("[Vault Doctor] loaded");
  }

  onunload(): void {
    console.log("[Vault Doctor] unloaded");
  }
}
