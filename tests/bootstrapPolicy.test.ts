import { describe, expect, it } from "vitest";

import { bootstrapPromptForRoute } from "../src/bootstrapPolicy";
import { parseExtensionSettings } from "../src/settings";

const selectedProjectId = "g-p-11111111111111111111111111111111";
const otherProjectId = "g-p-22222222222222222222222222222222";

const settings = parseExtensionSettings({
  schemaVersion: 1,
  projects: [
    { id: selectedProjectId, name: "Gateway Pilot" },
    { id: otherProjectId, name: "Other Project" },
  ],
  selectedProjectIds: [selectedProjectId],
  bootstrapPrompt: "Project: {{projects}}",
});

describe("bootstrap project route policy", () => {
  it("allows only a new chat in the selected current project", () => {
    expect(
      bootstrapPromptForRoute(settings, {
        projectId: selectedProjectId,
        kind: "new",
      }),
    ).toBe("Project: Gateway Pilot");
  });

  it("rejects existing project conversations", () => {
    expect(
      bootstrapPromptForRoute(settings, {
        projectId: selectedProjectId,
        kind: "conversation",
      }),
    ).toBe("");
  });

  it("rejects new chats in projects that are not selected", () => {
    expect(
      bootstrapPromptForRoute(settings, {
        projectId: otherProjectId,
        kind: "new",
      }),
    ).toBe("");
  });

  it("rejects chats outside ChatGPT projects", () => {
    expect(bootstrapPromptForRoute(settings, null)).toBe("");
  });
});
