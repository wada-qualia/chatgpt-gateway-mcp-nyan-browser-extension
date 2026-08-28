// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatGptDomAdapter } from "../src/domAdapter";

const adapter = new ChatGptDomAdapter();

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    x,
    y,
    width,
    height,
    top: y,
    right: x + width,
    bottom: y + height,
    left: x,
    toJSON: () => ({}),
  } as DOMRect;
}

function setRect(element: Element, value: DOMRect): void {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(value);
}

beforeEach(() => {
  document.body.innerHTML =
    '<main><form><div id="actions"><button type="button" aria-label="Add files and more">+</button></div><div id="primary"><div><textarea aria-label="Message ChatGPT"></textarea></div></div><div id="trailing"></div></form><article data-message-author-role="assistant">Reply</article></main>';
});

describe("ChatGptDomAdapter", () => {
  it("resolves a unique composer and inserts without sending", () => {
    const composer = adapter.resolveComposer();
    expect(composer).toBeInstanceOf(HTMLTextAreaElement);
    expect(adapter.insertComposerText("hello")).toBe(true);
    expect((composer as HTMLTextAreaElement).value).toBe("hello");
  });

  it("fails closed when composer resolution is ambiguous", () => {
    document
      .querySelector("#primary")
      ?.insertAdjacentHTML("beforeend", "<textarea></textarea>");
    expect(adapter.resolveComposer()).toBeNull();
    expect(adapter.insertComposerText("do not guess")).toBe(false);
  });

  it("mounts composer controls out of layout in the left composer gutter", () => {
    const form = document.querySelector("form")!;
    const actionButton = document.querySelector("#actions button")!;
    setRect(form, rect(80, 20, 700, 52));
    setRect(actionButton, rect(87, 24, 44, 44));

    const control = document.createElement("div");
    expect(adapter.mountComposerControls(control)).toBe(true);
    expect(control.parentElement).toBe(document.body);
    expect(control.style.left).toBe("8px");
    expect(control.style.top).toBe("14px");
    expect(control.hidden).toBe(false);
    expect(adapter.mountComposerControls(document.createElement("div"))).toBe(
      false,
    );
  });

  it("anchors outside a compact outer composer surface when it extends left of the form", () => {
    const form = document.querySelector("form")!;
    const surface = form.parentElement!;
    const actionButton = document.querySelector("#actions button")!;
    setRect(form, rect(160, 40, 700, 52));
    setRect(surface, rect(112, 40, 748, 52));
    setRect(actionButton, rect(167, 44, 44, 44));

    const control = document.createElement("div");
    expect(adapter.mountComposerControls(control)).toBe(true);
    expect(control.parentElement).toBe(document.body);
    expect(control.style.left).toBe("40px");
    expect(control.style.top).toBe("34px");
    expect(control.hidden).toBe(false);
  });

  it("falls back to the composer field when the previous native slot has no rendered action button", () => {
    document
      .querySelector("#actions")
      ?.replaceChildren(document.createElement("input"));
    const form = document.querySelector("form")!;
    const composerField = document.querySelector("#primary")!;
    setRect(form, rect(80, 20, 700, 52));
    setRect(composerField, rect(87, 28, 666, 36));

    const control = document.createElement("div");
    expect(adapter.mountComposerControls(control)).toBe(true);
    expect(control.parentElement).toBe(document.body);
    expect(control.style.left).toBe("8px");
    expect(control.style.top).toBe("14px");
    expect(control.hidden).toBe(false);
  });

  it("moves controls to the bottom edge when the composer surface expands", () => {
    const form = document.querySelector("form")!;
    const actionButton = document.querySelector("#actions button")!;
    setRect(form, rect(160, 40, 700, 220));
    setRect(actionButton, rect(167, 44, 44, 44));

    const control = document.createElement("div");
    expect(adapter.mountComposerControls(control)).toBe(true);
    expect(control.style.left).toBe("88px");
    expect(control.style.top).toBe("194px");
    expect(control.hidden).toBe(false);
  });

  it("fails closed when the native action anchor is ambiguous or the gutter is too narrow", () => {
    document
      .querySelector("#actions")
      ?.insertAdjacentHTML(
        "beforeend",
        '<button type="button">second</button>',
      );
    const buttons = document.querySelectorAll("#actions button");
    setRect(buttons[0]!, rect(47, 4, 44, 44));
    setRect(buttons[1]!, rect(47, 4, 44, 44));
    expect(adapter.mountComposerControls(document.createElement("div"))).toBe(
      false,
    );

    buttons[1]?.remove();
    const form = document.querySelector("form")!;
    setRect(form, rect(20, 0, 700, 52));
    expect(adapter.mountComposerControls(document.createElement("div"))).toBe(
      false,
    );
  });

  it("mounts message actions idempotently", () => {
    const message = adapter.assistantMessages()[0]!;
    expect(
      adapter.mountMessageActions(message, document.createElement("div")),
    ).toBe(true);
    expect(
      adapter.mountMessageActions(message, document.createElement("div")),
    ).toBe(false);
  });

  it("prefills project bootstrap only when the chat and composer are empty", () => {
    document.querySelector('[data-message-author-role="assistant"]')?.remove();
    expect(adapter.isEmptyConversation()).toBe(true);
    expect(adapter.composerText()).toBe("");

    expect(adapter.insertComposerText("draft")).toBe(true);
    expect(adapter.isEmptyConversation()).toBe(false);

    const composer = adapter.resolveComposer() as HTMLTextAreaElement;
    composer.value = "";
    document
      .querySelector("main")
      ?.insertAdjacentHTML(
        "beforeend",
        '<article data-message-author-role="user">Existing turn</article>',
      );
    expect(adapter.isEmptyConversation()).toBe(false);
  });

  it("classifies only project-root URLs as new project chats", () => {
    const projectId = "g-p-11111111111111111111111111111111";
    expect(
      adapter.currentProjectRoute(
        `https://chatgpt.com/g/${projectId}-gateway-pilot/project`,
      ),
    ).toEqual({ projectId, kind: "new", conversationId: null });
    expect(
      adapter.currentProjectRoute(
        `https://chatgpt.com/g/${projectId}-gateway-pilot`,
      ),
    ).toEqual({ projectId, kind: "new", conversationId: null });
    expect(
      adapter.currentProjectRoute(
        `https://chatgpt.com/g/${projectId}-gateway-pilot/c/conversation-123`,
      ),
    ).toEqual({
      projectId,
      kind: "conversation",
      conversationId: "conversation-123",
    });
    expect(
      adapter.currentProjectRoute(
        `https://chatgpt.com/g/${projectId}-gateway-pilot/project/c/conversation-123`,
      ),
    ).toEqual({
      projectId,
      kind: "conversation",
      conversationId: "conversation-123",
    });
    expect(adapter.currentProjectRoute("https://chatgpt.com/")).toBeNull();
    expect(
      adapter.currentProjectRoute("https://chatgpt.com/c/conversation-123"),
    ).toBeNull();
    expect(
      adapter.currentProjectRoute(
        `https://example.com/g/${projectId}-gateway-pilot/project`,
      ),
    ).toBeNull();
  });

  it("discovers only native ChatGPT project roots rendered in the sidebar", () => {
    document.body.insertAdjacentHTML(
      "afterbegin",
      `<aside id="sidebar">
        <a href="/g/g-p-11111111111111111111111111111111-gateway-pilot/project"><span>Gateway Pilot</span></a>
        <a href="/g/g-p-22222222222222222222222222222222-extension-pilot/project">  Extension   Pilot  </a>
        <a href="/g/g-p-11111111111111111111111111111111-gateway-pilot/c/abc">Project chat</a>
        <a href="/g/g-custom-gpt">Custom GPT</a>
        <a href="/g/g-p-33333333333333333333333333333333-hidden/project" style="display:none">Hidden Project</a>
      </aside>
      <main id="project-main-link"><a href="/g/g-p-44444444444444444444444444444444-main/project">Main Project Link</a></main>`,
    );
    for (const anchor of document.querySelectorAll("#sidebar a")) {
      setRect(anchor, rect(20, 20, 240, 36));
    }
    const mainLink = document.querySelector("#project-main-link a")!;
    setRect(mainLink, rect(520, 20, 240, 36));

    expect(adapter.nativeProjects()).toEqual([
      {
        id: "g-p-11111111111111111111111111111111",
        name: "Gateway Pilot",
        href: "/g/g-p-11111111111111111111111111111111-gateway-pilot/project",
      },
      {
        id: "g-p-22222222222222222222222222222222",
        name: "Extension Pilot",
        href: "/g/g-p-22222222222222222222222222222222-extension-pilot/project",
      },
    ]);
  });
});
