// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import { ChatGptDomAdapter } from "../src/domAdapter";

const adapter = new ChatGptDomAdapter();

beforeEach(() => {
  document.body.innerHTML =
    '<main><form><textarea aria-label="Message ChatGPT"></textarea></form><article data-message-author-role="assistant">Reply</article></main>';
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
      .querySelector("form")
      ?.insertAdjacentHTML("beforeend", "<textarea></textarea>");
    expect(adapter.resolveComposer()).toBeNull();
    expect(adapter.insertComposerText("do not guess")).toBe(false);
  });

  it("mounts controls idempotently", () => {
    const control = document.createElement("div");
    expect(adapter.mountComposerControls(control)).toBe(true);
    expect(adapter.mountComposerControls(document.createElement("div"))).toBe(
      false,
    );
    const message = adapter.assistantMessages()[0]!;
    expect(
      adapter.mountMessageActions(message, document.createElement("div")),
    ).toBe(true);
    expect(
      adapter.mountMessageActions(message, document.createElement("div")),
    ).toBe(false);
  });
});
