// Vault Doctor — confirmation modal.
//
// Minimal yes/no modal used by the dispatcher whenever `requiresConfirmation`
// returns true. Resolves to a boolean so the caller can `if (!await confirm)`
// short-circuit cleanly.

import { App, Modal } from "obsidian";

export interface ConfirmOptions {
  title: string;
  body: string;
  destructive: boolean;
}

/**
 * Open a Cancel/Confirm modal and resolve when the user makes a choice.
 * Closing the modal (Esc, click-outside) counts as Cancel.
 *
 * The Confirm button picks up Obsidian's `mod-warning` class when
 * `destructive` is true so the visual treatment matches native delete dialogs.
 */
export async function confirmAction(
  app: App,
  opts: ConfirmOptions,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const modal = new ConfirmModal(app, opts, resolve);
    modal.open();
  });
}

class ConfirmModal extends Modal {
  private readonly opts: ConfirmOptions;
  private readonly resolveFn: (value: boolean) => void;
  private decided = false;

  constructor(
    app: App,
    opts: ConfirmOptions,
    resolveFn: (value: boolean) => void,
  ) {
    super(app);
    this.opts = opts;
    this.resolveFn = resolveFn;
  }

  onOpen(): void {
    this.titleEl.setText(this.opts.title);

    const body = this.contentEl.createDiv({ cls: "vd-confirm-body" });
    body.setText(this.opts.body);

    const buttons = this.contentEl.createDiv({ cls: "vd-confirm-buttons" });
    buttons.style.display = "flex";
    buttons.style.justifyContent = "flex-end";
    buttons.style.gap = "8px";
    buttons.style.marginTop = "16px";

    const cancelBtn = buttons.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => {
      this.decide(false);
    });

    const confirmBtn = buttons.createEl("button", { text: "Confirm" });
    confirmBtn.addClass("mod-cta");
    if (this.opts.destructive) {
      confirmBtn.addClass("mod-warning");
    }
    confirmBtn.addEventListener("click", () => {
      this.decide(true);
    });
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.decided) {
      this.decided = true;
      this.resolveFn(false);
    }
  }

  private decide(value: boolean): void {
    if (this.decided) return;
    this.decided = true;
    this.resolveFn(value);
    this.close();
  }
}
