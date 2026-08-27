export type Compatibility = {
  composer: boolean;
  assistantMessages: boolean;
  strategy: string;
};

export type NativeChatGptProject = {
  id: string;
  name: string;
  href: string;
};

const COMPOSER_CONTROL_SIZE_PX = 24;
const COMPOSER_CONTROL_GAP_PX = 8;
const COMPOSER_SURFACE_MAX_EXTRA_WIDTH_PX = 192;
const COMPOSER_SURFACE_MAX_EXTRA_HEIGHT_PX = 16;

function visible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function rendered(element: Element): boolean {
  if (!visible(element)) return false;
  if (typeof element.checkVisibility === "function") {
    if (
      !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    )
      return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
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

  private composerSurfaceRect(form: HTMLFormElement): DOMRect {
    const formRect = form.getBoundingClientRect();
    let surfaceRect = formRect;
    let ancestor = form.parentElement;
    for (let depth = 0; ancestor && depth < 3; depth += 1) {
      if (!rendered(ancestor)) break;
      const rect = ancestor.getBoundingClientRect();
      const extraWidth = rect.width - formRect.width;
      const extraHeight = rect.height - formRect.height;
      if (
        extraWidth < 0 ||
        extraHeight < 0 ||
        extraWidth > COMPOSER_SURFACE_MAX_EXTRA_WIDTH_PX ||
        extraHeight > COMPOSER_SURFACE_MAX_EXTRA_HEIGHT_PX ||
        rect.top > formRect.top + 8 ||
        rect.bottom < formRect.bottom - 8
      ) {
        break;
      }
      if (rect.left <= surfaceRect.left && rect.right >= surfaceRect.right) {
        surfaceRect = rect;
      }
      ancestor = ancestor.parentElement;
    }
    return surfaceRect;
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

  composerText(root: ParentNode = document): string | null {
    const composer = this.resolveComposer(root);
    if (!composer) return null;
    if (composer instanceof HTMLTextAreaElement) return composer.value;
    return composer.textContent ?? "";
  }

  isEmptyConversation(root: ParentNode = document): boolean {
    const composerText = this.composerText(root);
    if (composerText === null || composerText.trim().length > 0) return false;
    return (
      root.querySelector('[data-message-author-role="user"]') === null &&
      root.querySelector('[data-message-author-role="assistant"]') === null
    );
  }

  nativeProjects(root: ParentNode = document): NativeChatGptProject[] {
    const anchors = [
      ...root.querySelectorAll<HTMLAnchorElement>('a[href*="/g/g-p-"]'),
    ].filter(rendered);
    const sidebarSelectors =
      'nav, aside, [data-testid*="sidebar" i], [class*="sidebar" i]';
    const sidebarAnchors = anchors.filter((anchor) =>
      anchor.closest(sidebarSelectors),
    );
    const maxSidebarLeft = Math.min(420, window.innerWidth * 0.45);
    const candidates =
      sidebarAnchors.length > 0
        ? sidebarAnchors
        : anchors.filter((anchor) => {
            const rect = anchor.getBoundingClientRect();
            return rect.left < maxSidebarLeft && rect.width <= 400;
          });
    const projects = new Map<string, NativeChatGptProject>();
    for (const anchor of candidates) {
      const rawHref = anchor.getAttribute("href");
      if (!rawHref) continue;
      let url: URL;
      try {
        url = new URL(rawHref, window.location.href);
      } catch {
        continue;
      }
      if (url.origin !== window.location.origin) continue;
      const match = url.pathname.match(
        /^\/g\/(g-p-[A-Za-z0-9]+)(?:-[^/]+)?(?:\/project)?\/?$/u,
      );
      const id = match?.[1];
      if (!id) continue;
      const name =
        [anchor.textContent, anchor.title, anchor.getAttribute("aria-label")]
          .map((value) => (value ?? "").replace(/\s+/gu, " ").trim())
          .find((value) => value.length > 0) ?? "";
      if (!name || projects.has(id)) continue;
      projects.set(id, { id, name, href: `${url.pathname}${url.search}` });
    }
    return [...projects.values()];
  }

  positionComposerControls(
    control: HTMLElement,
    root: ParentNode = document,
  ): boolean {
    const composer = this.resolveComposer(root);
    if (!composer) {
      control.hidden = true;
      return false;
    }
    const form = composer.closest("form");
    if (!form) {
      control.hidden = true;
      return false;
    }
    let composerField: HTMLElement | null = composer.parentElement;
    while (composerField && composerField.parentElement !== form) {
      if (composerField === form) {
        composerField = null;
        break;
      }
      composerField = composerField.parentElement;
    }
    if (!composerField) {
      control.hidden = true;
      return false;
    }
    const actionField = composerField.previousElementSibling;
    let anchorRect = composerField.getBoundingClientRect();
    if (actionField instanceof HTMLElement && visible(actionField)) {
      const actionButtons = [
        ...actionField.querySelectorAll<HTMLButtonElement>("button"),
      ].filter(rendered);
      if (actionButtons.length > 1) {
        control.hidden = true;
        return false;
      }
      if (actionButtons.length === 1) {
        anchorRect = actionButtons[0]!.getBoundingClientRect();
      }
    }
    const surfaceRect = this.composerSurfaceRect(form);
    const left =
      surfaceRect.left - COMPOSER_CONTROL_SIZE_PX - COMPOSER_CONTROL_GAP_PX;
    const top =
      anchorRect.top + (anchorRect.height - COMPOSER_CONTROL_SIZE_PX) / 2;
    if (
      left < 0 ||
      top < 0 ||
      left + COMPOSER_CONTROL_SIZE_PX > window.innerWidth ||
      top + COMPOSER_CONTROL_SIZE_PX > window.innerHeight
    ) {
      control.hidden = true;
      return false;
    }
    control.style.left = `${Math.round(left)}px`;
    control.style.top = `${Math.round(top)}px`;
    control.hidden = false;
    return true;
  }

  mountComposerControls(
    control: HTMLElement,
    root: ParentNode = document,
  ): boolean {
    const composer = this.resolveComposer(root);
    if (!composer) return false;
    const form = composer.closest("form");
    const ownerDocument = composer.ownerDocument;
    if (
      !form ||
      !ownerDocument.body ||
      ownerDocument.querySelector('[data-atlas-extension-root="composer"]')
    )
      return false;
    if (!this.positionComposerControls(control, root)) return false;
    control.dataset.atlasExtensionRoot = "composer";
    ownerDocument.body.append(control);
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
