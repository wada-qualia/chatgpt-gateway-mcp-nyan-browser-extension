export const EXTENSION_SETTINGS_KEY = "atlas.extensionSettings.v1";
export const MAX_PROJECTS = 32;
export const MAX_PROJECT_NAME_LENGTH = 120;
export const MAX_BOOTSTRAP_PROMPT_LENGTH = 12_000;

export const DEFAULT_BOOTSTRAP_PROMPT = `Работай в контексте проекта(ов): {{projects}}.

Используй ChatGPT Gateway / ATLAS как control plane. В начале вызови ATLAS.list_resources, выбери доступный thin client или SSH device, затем проверь Git root, branch, HEAD, status, worktrees и локальные AGENTS.md/README. До изменений зафиксируй baseline, acceptance criteria, tests, rollback и риски. Пиши и коммить только в source-of-truth репозитории проекта; protected branches изменяй через feature branch и merge request. После изменений проверь diff, tests, exact-SHA CI и runtime/E2E там, где это требуется. Не раскрывай secrets и не вмешивайся в чужие sessions, processes или containers.`;

export type ExtensionProject = {
  id: string;
  name: string;
};

export type ExtensionSettings = {
  schemaVersion: 1;
  projects: ExtensionProject[];
  selectedProjectIds: string[];
  bootstrapPrompt: string;
};

const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

export function defaultExtensionSettings(): ExtensionSettings {
  return {
    schemaVersion: 1,
    projects: [],
    selectedProjectIds: [],
    bootstrapPrompt: DEFAULT_BOOTSTRAP_PROMPT,
  };
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid extension settings");
  }
  return value as Record<string, unknown>;
}

export function parseExtensionSettings(value: unknown): ExtensionSettings {
  if (value === undefined) return defaultExtensionSettings();
  const input = record(value);
  if (
    input.schemaVersion !== 1 ||
    !Array.isArray(input.projects) ||
    input.projects.length > MAX_PROJECTS ||
    !Array.isArray(input.selectedProjectIds) ||
    typeof input.bootstrapPrompt !== "string" ||
    input.bootstrapPrompt.length > MAX_BOOTSTRAP_PROMPT_LENGTH
  ) {
    throw new Error("invalid extension settings");
  }

  const projects: ExtensionProject[] = [];
  const projectIds = new Set<string>();
  for (const rawProject of input.projects) {
    const project = record(rawProject);
    const id = typeof project.id === "string" ? project.id.trim() : "";
    const name = typeof project.name === "string" ? project.name.trim() : "";
    if (
      !PROJECT_ID_PATTERN.test(id) ||
      !name ||
      name.length > MAX_PROJECT_NAME_LENGTH ||
      projectIds.has(id)
    ) {
      throw new Error("invalid extension settings");
    }
    projectIds.add(id);
    projects.push({ id, name });
  }

  const selectedProjectIds: string[] = [];
  const selected = new Set<string>();
  for (const rawId of input.selectedProjectIds) {
    if (
      typeof rawId !== "string" ||
      !projectIds.has(rawId) ||
      selected.has(rawId)
    ) {
      throw new Error("invalid extension settings");
    }
    selected.add(rawId);
    selectedProjectIds.push(rawId);
  }

  return {
    schemaVersion: 1,
    projects,
    selectedProjectIds,
    bootstrapPrompt: input.bootstrapPrompt,
  };
}

export function renderBootstrapPrompt(settings: ExtensionSettings): string {
  const selectedNames = settings.projects
    .filter((project) => settings.selectedProjectIds.includes(project.id))
    .map((project) => project.name);
  if (selectedNames.length === 0 || !settings.bootstrapPrompt.trim()) return "";
  const projectText = selectedNames.join(", ");
  if (settings.bootstrapPrompt.includes("{{projects}}")) {
    return settings.bootstrapPrompt.replaceAll("{{projects}}", projectText);
  }
  return `${settings.bootstrapPrompt.trimEnd()}\n\nSelected project(s): ${projectText}`;
}
