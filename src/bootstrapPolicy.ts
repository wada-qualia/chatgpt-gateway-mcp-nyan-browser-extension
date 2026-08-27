import type { ChatGptProjectRoute } from "./domAdapter";
import {
  renderBootstrapPromptForProject,
  type ExtensionSettings,
} from "./settings";

export function bootstrapPromptForRoute(
  settings: ExtensionSettings,
  route: ChatGptProjectRoute | null,
): string {
  if (!route || route.kind !== "new") return "";
  return renderBootstrapPromptForProject(settings, route.projectId);
}
