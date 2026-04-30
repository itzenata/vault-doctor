// Vault Doctor — settings tab UI.
//
// Pure Obsidian `Setting` builder API. The tab is grouped into four sections:
//   1. Profile        (preset dropdown — adjusts thresholds)
//   2. Rules          (per-rule toggles, sourced dynamically from ALL_RULES)
//   3. Exclusions     (folders and tags, comma- or newline-separated)
//   4. Scan & safety  (schedule trigger, dry-run, backup, bulk threshold)
//
// Every change funnels through `store.update(...)` so persistence stays
// centralized. The profile selector triggers a full re-render so dependent
// fields (currently bulkConfirmThreshold) reflect the new preset.

import {
  type App,
  type Plugin,
  PluginSettingTab,
  Setting,
} from "obsidian";
import { ALL_RULES } from "../rules";
import type { SettingsStore } from "./store";
import {
  PROFILE_PRESETS,
  type Profile,
  type ScanTrigger,
} from "./types";

const PROFILE_LABELS: Record<Profile, string> = {
  strict: "Strict",
  standard: "Standard",
  indulgent: "Indulgent",
};

const SCAN_LABELS: Record<ScanTrigger, string> = {
  manual: "Manual only",
  open: "On vault open",
  daily: "Daily",
  weekly: "Weekly",
};

export class SettingsTab extends PluginSettingTab {
  constructor(
    app: App,
    plugin: Plugin,
    private readonly store: SettingsStore,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.renderProfileSection(containerEl);
    this.renderRulesSection(containerEl);
    this.renderExclusionsSection(containerEl);
    this.renderScanAndSafetySection(containerEl);
  }

  // -- Section 1: Profile -------------------------------------------------

  private renderProfileSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Profile").setHeading();

    new Setting(containerEl)
      .setName("Vault profile")
      .setDesc(
        "Strict flags everything; Standard balances signal vs noise; Indulgent only surfaces critical issues.",
      )
      .addDropdown((dd) => {
        for (const key of Object.keys(PROFILE_LABELS) as Profile[]) {
          dd.addOption(key, PROFILE_LABELS[key]);
        }
        dd.setValue(this.store.values.profile).onChange(async (raw) => {
          const profile = raw as Profile;
          await this.applyProfile(profile);
          // Re-render so the threshold input reflects the new preset.
          this.display();
        });
      });
  }

  /**
   * Apply preset values for the chosen profile and persist. Today this only
   * touches `bulkConfirmThreshold`; richer policies will plug in here.
   */
  private async applyProfile(profile: Profile): Promise<void> {
    const preset = PROFILE_PRESETS[profile];
    await this.store.patch({
      profile,
      bulkConfirmThreshold: preset.bulkConfirmThreshold,
    });
  }

  // -- Section 2: Rules ---------------------------------------------------

  private renderRulesSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Rules").setHeading();

    for (const rule of ALL_RULES) {
      new Setting(containerEl)
        .setName(rule.name)
        .setDesc(`${rule.id} · ${rule.description}`)
        .addToggle((tog) => {
          const current = this.store.values.enabledRules[rule.id] ?? true;
          tog.setValue(current).onChange(async (value) => {
            const next = { ...this.store.values.enabledRules, [rule.id]: value };
            await this.store.update("enabledRules", next);
          });
        });
    }
  }

  // -- Section 3: Exclusions ----------------------------------------------

  private renderExclusionsSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Exclusions").setHeading();

    new Setting(containerEl)
      .setName("Excluded folders")
      .setDesc(
        "Folder path prefixes to skip during scans. Comma- or newline-separated. Example: templates/, _archive/",
      )
      .addTextArea((ta) => {
        ta.setPlaceholder("templates/\n_archive/");
        ta.setValue(this.store.values.excludedFolders.join("\n"));
        ta.inputEl.rows = 4;
        ta.inputEl.style.width = "100%";
        ta.onChange(async (value) => {
          await this.store.update("excludedFolders", parseList(value));
        });
      });

    new Setting(containerEl)
      .setName("Excluded tags")
      .setDesc(
        "Tag values to skip during scans. Comma- or newline-separated. Example: #wip, #draft",
      )
      .addTextArea((ta) => {
        ta.setPlaceholder("#wip\n#draft");
        ta.setValue(this.store.values.excludedTags.join("\n"));
        ta.inputEl.rows = 4;
        ta.inputEl.style.width = "100%";
        ta.onChange(async (value) => {
          await this.store.update("excludedTags", parseList(value));
        });
      });
  }

  // -- Section 4: Scan schedule + Safety ----------------------------------

  private renderScanAndSafetySection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Scan & safety").setHeading();

    new Setting(containerEl)
      .setName("Scan schedule")
      .setDesc("When the scan runs automatically.")
      .addDropdown((dd) => {
        for (const key of Object.keys(SCAN_LABELS) as ScanTrigger[]) {
          dd.addOption(key, SCAN_LABELS[key]);
        }
        dd.setValue(this.store.values.scanOn).onChange(async (raw) => {
          await this.store.update("scanOn", raw as ScanTrigger);
        });
      });

    new Setting(containerEl)
      .setName("Dry run by default")
      .setDesc("Preview action results instead of mutating the vault.")
      .addToggle((tog) => {
        tog
          .setValue(this.store.values.dryRunDefault)
          .onChange(async (value) => {
            await this.store.update("dryRunDefault", value);
          });
      });

    new Setting(containerEl)
      .setName("Auto-backup before bulk actions")
      .setDesc("Snapshot affected notes before destructive bulk operations.")
      .addToggle((tog) => {
        tog.setValue(this.store.values.autoBackup).onChange(async (value) => {
          await this.store.update("autoBackup", value);
        });
      });

    new Setting(containerEl)
      .setName("Bulk confirmation threshold")
      .setDesc(
        "Show a confirmation prompt when an action would touch more than this many items. 0 = always confirm.",
      )
      .addText((txt) => {
        txt.inputEl.type = "number";
        txt.inputEl.min = "0";
        txt.setValue(String(this.store.values.bulkConfirmThreshold));
        txt.onChange(async (raw) => {
          const parsed = Number.parseInt(raw, 10);
          if (Number.isFinite(parsed) && parsed >= 0) {
            await this.store.update("bulkConfirmThreshold", parsed);
          }
        });
      });
  }
}

/**
 * Parse a comma- or newline-separated string into a trimmed, deduped list.
 * Empty entries are dropped so a stray trailing comma doesn't pollute state.
 */
function parseList(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of raw.split(/[,\n]/)) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
