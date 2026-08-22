export type Compatibility = {
  composer: boolean;
  assistantMessages: boolean;
  strategy: string;
};

function visible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

export class ChatGptDomAdapter {
  resolveComposer(root: ParentNode = document): HTMLElement | null {
    const candidates = [
      ...root.querySelectorAll<HTMLElement>("form textarea"),
      ...root.querySelectorAll<HTMLElement>('form [contenteditable="true"]'),
      ...root.querySelectorAll<HTMLElement>('[data-testid="prompt-textarea"]'),
    ].filter(visible);
    const unique = [...new Set(candidates)];
    return unique.length === 1 ? (unique[0] ?? null) : null;
  }

  probeCompatibility(root: ParentNode = document): Compatibility {
    return {
      composer: this.resolveComposer(root) !== null,
      assistantMessages:
        root.querySelector('[data-message-author-role="assistant"]') !== null,
      strategy: "semantic-form-v1",
    };
  }

  insertComposerText(text: string, root: ParentNode = document): boolean {
    const composer = this.resolveComposer(root);
    if (!composer || text.length === 0) return false;
    composer.focus();
    if (composer instanceof HTMLTextAreaElement) {
      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      );
      // Accessor functions are intentionally invoked with the textarea as `this`.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const setter = descriptor?.set;
      if (setter) Reflect.apply(setter, composer, [text]);
    } else {
      composer.textContent = text;
    }
    composer.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text,
      }),
    );
    return true;
  }

  mountComposerControls(
    control: HTMLElement,
    root: ParentNode = document,
  ): boolean {
    const composer = this.resolveComposer(root);
    if (!composer) return false;
    const form = composer.closest("form");
    if (!form || form.querySelector('[data-atlas-extension-root="composer"]'))
      return false;
    control.dataset.atlasExtensionRoot = "composer";
    form.append(control);
    return true;
  }

  assistantMessages(root: ParentNode = document): HTMLElement[] {
    return [
      ...root.querySelectorAll<HTMLElement>(
        '[data-message-author-role="assistant"]',
      ),
    ].filter(visible);
  }

  mountMessageActions(message: HTMLElement, control: HTMLElement): boolean {
    if (message.querySelector('[data-atlas-extension-root="message-actions"]'))
      return false;
    control.dataset.atlasExtensionRoot = "message-actions";
    message.append(control);
    return true;
  }

  async branchInNewChat(message: HTMLElement): Promise<boolean> {
    const buttons = [
      ...message.querySelectorAll<HTMLButtonElement>("button"),
    ].filter(visible);
    const moreButtons = buttons.filter((button) =>
      /more|ещ[её]|weitere|その他/i.test(
        button.getAttribute("aria-label") ?? button.textContent ?? "",
      ),
    );
    if (moreButtons.length !== 1) return false;
    moreButtons[0]?.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const menuItems = [
      ...document.querySelectorAll<HTMLElement>(
        '[role="menuitem"], [role="menu"] button',
      ),
    ].filter(visible);
    const branches = menuItems.filter((item) =>
      /branch in new chat|ответв.*чат|in neuem chat verzweigen/i.test(
        item.textContent ?? "",
      ),
    );
    if (branches.length !== 1) return false;
    branches[0]?.click();
    return true;
  }
}
