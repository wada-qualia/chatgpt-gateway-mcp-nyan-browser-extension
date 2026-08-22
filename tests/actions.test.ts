import { describe, expect, it } from "vitest";

import { parseAtlasActions } from "../src/actions";

function block(payload: unknown): string {
  return `answer\n\n\`\`\`atlas-actions\n${JSON.stringify(payload)}\n\`\`\``;
}

const valid = {
  schema_version: 1,
  workflow: "implementation-phases",
  actions: [
    {
      id: "phase-1",
      label: "Open phase 1",
      kind: "compose",
      prompt: "Implement phase one.",
    },
  ],
};

describe("parseAtlasActions", () => {
  it("accepts one valid tagged block", () => {
    expect(parseAtlasActions(block(valid))?.actions[0]?.id).toBe("phase-1");
  });

  it.each([
    "plain prose",
    "```atlas-actions\nnot json\n```",
    `${block(valid)}\n${block(valid)}`,
  ])("rejects malformed or multiple blocks", (text) => {
    expect(parseAtlasActions(text)).toBeNull();
  });

  it("rejects duplicate ids, unknown fields, URLs and auto-send", () => {
    expect(parseAtlasActions(block({ ...valid, extra: true }))).toBeNull();
    expect(
      parseAtlasActions(
        block({
          ...valid,
          actions: [...valid.actions, { ...valid.actions[0] }],
        }),
      ),
    ).toBeNull();
    expect(
      parseAtlasActions(
        block({
          ...valid,
          actions: [
            { ...valid.actions[0], prompt: "Visit https://example.test" },
          ],
        }),
      ),
    ).toBeNull();
    expect(
      parseAtlasActions(
        block({
          ...valid,
          actions: [{ ...valid.actions[0], auto_send: true }],
        }),
      ),
    ).toBeNull();
  });

  it("rejects prototype-pollution keys", () => {
    const text =
      '```atlas-actions\n{"schema_version":1,"workflow":"x","actions":[{"id":"x","label":"x","kind":"compose","prompt":"x","constructor":{}}]}\n```';
    expect(parseAtlasActions(text)).toBeNull();
  });
});
