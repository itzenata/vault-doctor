---
name: Suggest a detection rule
about: Propose a new rule (e.g. "stale draft notes", "frontmatter type mismatch") for Vault Doctor to detect
labels: ["rule-suggestion", "needs-triage"]
---

## Rule name

<!-- Short, scannable. Example: "Stale draft notes" -->

## What does it detect?

<!-- One sentence describing the unhealthy condition. -->

## Why does it matter?

<!-- What pain or risk does this rule prevent? Real example from your own vault is the best signal. -->

## Suggested severity

- [ ] 🔴 Critical (data loss / broken state)
- [ ] 🟡 Warning (degraded vault hygiene)
- [ ] 🔵 Info (cleanup opportunity)

## Detection logic (your best guess)

<!-- How would a scan find these notes? Frontmatter check? Backlink count? Filename pattern? Time since last modified? -->

## Can it be auto-fixed?

<!-- Y / N. If yes, what's the safe default action (archive / rename / delete to trash)? -->

## Example notes that would trip this rule

<!-- 2-3 anonymized examples from your own vault if possible. -->
