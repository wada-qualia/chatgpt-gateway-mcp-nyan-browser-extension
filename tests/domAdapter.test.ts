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
    setRect(form, rect(40, 0, 700, 52));
    setRect(actionButton, rect(47, 4, 44, 44));

    const control = document.createElement("div");
    expect(adapter.mountComposerControls(control)).toBe(true);
    expect(control.parentElement).toBe(document.querySelector("form"));
    expect(control.style.left).toBe("8px");
    expect(control.style.top).toBe("14px");
    expect(control.hidden).toBe(false);
    expect(adapter.mountComposerControls(document.createElement("div"))).toBe(
      false,
    );
  });

  it("falls back to the composer field when the previous native slot has no rendered action button", () => {
    document
      .querySelector("#actions")
      ?.replaceChildren(document.createElement("input"));
    const form = document.querySelector("form")!;
    const composerField = document.querySelector("#primary")!;
    setRect(form, rect(40, 0, 700, 52));
    setRect(composerField, rect(47, 8, 666, 36));

    const control = document.createElement("div");
    expect(adapter.mountComposerControls(control)).toBe(true);
    expect(control.parentElement).toBe(form);
    expect(control.style.left).toBe("8px");
    expect(control.style.top).toBe("14px");
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
});
