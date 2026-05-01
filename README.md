# Vault Doctor

> Audit + auto-cleanup plugin for Obsidian. **Alpha — working build, not yet in the community store.**

[![License: MIT](https://img.shields.io/github/license/itzenata/vault-doctor?color=blue)](LICENSE)
[![Status: alpha](https://img.shields.io/badge/status-alpha-yellow)](#whats-working-today)
[![Made for Obsidian](https://img.shields.io/badge/made%20for-Obsidian-7c3aed?logo=obsidian&logoColor=white)](https://obsidian.md)
[![Stars](https://img.shields.io/github/stars/itzenata/vault-doctor?style=social)](https://github.com/itzenata/vault-doctor/stargazers)
[![Last commit](https://img.shields.io/github/last-commit/itzenata/vault-doctor?color=green)](https://github.com/itzenata/vault-doctor/commits/main)

🌐 **Landing page:** [itzenata.github.io/vault-doctor](https://itzenata.github.io/vault-doctor/)

## What it does

A vault-wide scan that produces a **0–100 health score** and groups every detected issue by severity. One pane, one click per fix, no automation surprises.

**Hard rules:** local-first (zero network), dry-run by default, no real `delete` (system trash only), persistent whitelist via note frontmatter.

![Vault Doctor dashboard](./mockup.png)

## What's working today

**10 detection rules**, all running in a single scan:

| Rule | Severity | What it catches |
|---|---|---|
| `BROKEN-LINK` | critical | `[[wikilink]]` that resolves to nothing |
| `BROKEN-EMBED` | critical | `![[file]]` whose target is missing |
| `DUPLICATE-EXACT` | critical | Two notes with identical content (older one wins as canonical) |
| `ORPHAN-NOTE` | warning | No inbound or outbound links — abandoned in your graph |
| `EMPTY-NOTE` | warning | Body under 50 characters |
| `ORPHAN-ATTACHMENT` | info | Image/PDF/audio file no note references |
| `OVERSIZED-NOTE` | info | Above ~50 k words — split candidate |
| `STALE-NOTE` | info | Untouched for 12+ months |
| `DAILY-GAP` | info | Missing day in your daily-note sequence |
| `TAG-INCONSISTENT` | info | `#projet` / `#Projet` / `#projets` — same logical tag, different surface forms |

**UI:** dashboard with health score, issues grouped by severity, per-rule "Fix all", "Show all" deep-dive, Guided Cleanup wizard with **per-issue action override** (archive this one, delete that one, skip the third), settings tab (profiles, per-rule toggles, exclusions), and a status-bar widget showing the live score color-coded by band.

**Actions:** archive (into `_archive/`), delete (system trash, with confirmation), whitelist (`vault-doctor: ignore` frontmatter or settings list for non-markdown), and per-rule auto-fix:

- `BROKEN-LINK` / `BROKEN-EMBED` → interactive replacement picker
- `TAG-INCONSISTENT` → rewrite all variants in the note to the canonical surface form
- `DAILY-GAP` → create the missing daily note in the same folder

**Safety:** every destructive bulk action takes a content snapshot into `.obsidian/plugins/vault-doctor/backups/{ISO-timestamp}/` first. The command palette exposes `Vault Doctor: Undo last destructive action`, which restores the last batch's files in place.

## Hard rules

- **100% local.** No network calls. No telemetry. No remote config.
- **Dry-run by default.** Every destructive action opens a confirmation modal.
- **System trash only.** Files go to the OS trash — recoverable until you empty it. Combined with the per-batch snapshot, recovery doesn't depend on the trash being intact.
- **Persistent whitelist.** `vault-doctor: ignore` in the note's frontmatter. Survives reindex, travels with the file across vaults.
- **Mobile read-only in v1.** Score visible on phone, no mutations.

## Try it (sideload)

Not yet in the community store. To try the alpha:

```bash
git clone https://github.com/itzenata/vault-doctor.git
cd vault-doctor
npm install
npm run build
```

Then symlink the built plugin into your vault:

```bash
ln -sfn "$(pwd)" /path/to/your-vault/.obsidian/plugins/vault-doctor
```

In Obsidian: **Settings → Community plugins → enable Vault Doctor**, then `Ctrl/Cmd+R` to reload.

> **First time? Try the test vault.** A pre-built vault that triggers every rule once lives in [`/_docs/lifeeasy/test/`](https://github.com/itzenata/vault-doctor) of the parent workspace — useful for validating detection without touching your real notes.

## Progress

- [x] Public spec, MIT-licensed ([PRD.md](./PRD.md))
- [x] Dashboard mockup → shipped UI ([mockup.html](./mockup.html))
- [x] [Landing page](https://itzenata.github.io/vault-doctor/) on GitHub Pages
- [x] [Issue templates](.github/ISSUE_TEMPLATE) for bugs, features, rule suggestions
- [x] MVP scan engine + all 10 detection rules
- [x] Dashboard, "Show all" view, Guided Cleanup with per-issue overrides
- [x] Action layer: archive / delete / whitelist / interactive fix
- [x] First installable build (sideload, see above)
- [x] Settings tab — profiles (Strict / Standard / Indulgent), per-rule toggles, exclusions
- [x] Status bar widget with current score, color-coded, click-to-open
- [x] Auto-backup before destructive actions → `.obsidian/plugins/vault-doctor/backups/`
- [x] Undo last destructive action (command palette: `Vault Doctor: Undo last destructive action`)
- [x] Auto-fix wired for `BROKEN-LINK`, `BROKEN-EMBED`, `TAG-INCONSISTENT`, `DAILY-GAP`
- [ ] Reddit r/ObsidianMD validation post + 60s demo video
- [ ] Performance benchmark on 10k-note vault (PRD claim: < 30 s)
- [ ] Community plugin store submission

## Get involved

- ⭐ Star to follow progress
- 💡 [Suggest a detection rule](https://github.com/itzenata/vault-doctor/issues/new?template=rule_suggestion.md)
- 💬 [Open an issue](https://github.com/itzenata/vault-doctor/issues/new/choose) for any vault hygiene problem you'd want solved

## Development

```bash
npm install
npm run dev      # esbuild watch → main.js
npm run build    # production bundle + typecheck
```

Code layout: `main.ts` is the plugin entry; the engine, rules, action handlers, and UI live under [`src/`](./src). The full design intent is in [`PRD.md`](./PRD.md) — read §6 (rules), §7 (architecture), §9 (safety guardrails) before contributing.

License: [MIT](./LICENSE)
