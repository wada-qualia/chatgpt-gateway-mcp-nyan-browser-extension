import { describe, expect, it } from "vitest";

import {
  DEFAULT_BOOTSTRAP_PROMPT,
  defaultExtensionSettings,
  parseExtensionSettings,
  renderBootstrapPrompt,
  renderBootstrapPromptForProject,
} from "../src/settings";

describe("extension settings", () => {
  it("uses a safe default with no selected project", () => {
    expect(parseExtensionSettings(undefined)).toEqual(
      defaultExtensionSettings(),
    );
    expect(defaultExtensionSettings().bootstrapPrompt).toBe(
      DEFAULT_BOOTSTRAP_PROMPT,
    );
    expect(renderBootstrapPrompt(defaultExtensionSettings())).toBe("");
  });

  it("validates projects and renders selected project names", () => {
    const settings = parseExtensionSettings({
      schemaVersion: 1,
      projects: [
        { id: "gateway", name: "ChatGPT Gateway" },
        { id: "extension", name: "Browser Extension" },
      ],
      selectedProjectIds: ["gateway", "extension"],
      bootstrapPrompt: "Projects: {{projects}}",
    });
    expect(renderBootstrapPrompt(settings)).toBe(
      "Projects: ChatGPT Gateway, Browser Extension",
    );
  });

  it("renders bootstrap only for the current selected project", () => {
    const settings = parseExtensionSettings({
      schemaVersion: 1,
      projects: [
        { id: "gateway", name: "ChatGPT Gateway" },
        { id: "extension", name: "Browser Extension" },
      ],
      selectedProjectIds: ["gateway"],
      bootstrapPrompt: "Project: {{projects}}",
    });
    expect(renderBootstrapPromptForProject(settings, "gateway")).toBe(
      "Project: ChatGPT Gateway",
    );
    expect(renderBootstrapPromptForProject(settings, "extension")).toBe("");
    expect(renderBootstrapPromptForProject(settings, "missing")).toBe("");
  });

  it("appends selected projects when the placeholder is omitted", () => {
    const settings = parseExtensionSettings({
      schemaVersion: 1,
      projects: [{ id: "gateway", name: "ChatGPT Gateway" }],
      selectedProjectIds: ["gateway"],
      bootstrapPrompt: "Use ATLAS first.",
    });
    expect(renderBootstrapPrompt(settings)).toBe(
      "Use ATLAS first.\n\nSelected project(s): ChatGPT Gateway",
    );
  });

  it("rejects duplicate ids and selections outside the project set", () => {
    expect(() =>
      parseExtensionSettings({
        schemaVersion: 1,
        projects: [
          { id: "same", name: "One" },
          { id: "same", name: "Two" },
        ],
        selectedProjectIds: [],
        bootstrapPrompt: "prompt",
      }),
    ).toThrow("invalid extension settings");
    expect(() =>
      parseExtensionSettings({
        schemaVersion: 1,
        projects: [{ id: "one", name: "One" }],
        selectedProjectIds: ["missing"],
        bootstrapPrompt: "prompt",
      }),
    ).toThrow("invalid extension settings");
  });
});
