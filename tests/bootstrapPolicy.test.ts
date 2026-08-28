import { describe, expect, it } from "vitest";

import {
  bootstrapPromptForRoute,
  canApplyAsyncBootstrap,
} from "../src/bootstrapPolicy";
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
        conversationId: null,
      }),
    ).toBe("Project: Gateway Pilot");
  });

  it("rejects existing project conversations", () => {
    expect(
      bootstrapPromptForRoute(settings, {
        projectId: selectedProjectId,
        kind: "conversation",
        conversationId: "conversation-123",
      }),
    ).toBe("");
  });

  it("rejects new chats in projects that are not selected", () => {
    expect(
      bootstrapPromptForRoute(settings, {
        projectId: otherProjectId,
        kind: "new",
        conversationId: null,
      }),
    ).toBe("");
  });

  it("rejects chats outside ChatGPT projects", () => {
    expect(bootstrapPromptForRoute(settings, null)).toBe("");
  });
});

describe("async bootstrap race policy", () => {
  it("accepts only the same selected new-chat route after allocation", () => {
    expect(
      canApplyAsyncBootstrap(
        selectedProjectId,
        { projectId: selectedProjectId, kind: "new", conversationId: null },
        true,
        true,
      ),
    ).toBe(true);
  });

  it("fails closed when SPA navigation, composer identity, or chat emptiness changes", () => {
    expect(
      canApplyAsyncBootstrap(
        selectedProjectId,
        {
          projectId: selectedProjectId,
          kind: "conversation",
          conversationId: "conversation-123",
        },
        true,
        true,
      ),
    ).toBe(false);
    expect(
      canApplyAsyncBootstrap(
        selectedProjectId,
        { projectId: otherProjectId, kind: "new", conversationId: null },
        true,
        true,
      ),
    ).toBe(false);
    expect(
      canApplyAsyncBootstrap(
        selectedProjectId,
        { projectId: selectedProjectId, kind: "new", conversationId: null },
        false,
        true,
      ),
    ).toBe(false);
    expect(
      canApplyAsyncBootstrap(
        selectedProjectId,
        { projectId: selectedProjectId, kind: "new", conversationId: null },
        true,
        false,
      ),
    ).toBe(false);
  });
});
