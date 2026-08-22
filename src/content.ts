import { parseAtlasActions } from "./actions";
import { ChatGptDomAdapter } from "./domAdapter";
import type { AtlasAction, RuntimeRequest, RuntimeResponse } from "./types";

const adapter = new ChatGptDomAdapter();
const promptModes: Array<[string, string]> = [
  ["Takeoff", "takeoff"],
  ["Plan", "plan"],
  ["Phases", "phases"],
  ["Current phase", "current_phase"],
];

async function runtime(request: RuntimeRequest): Promise<RuntimeResponse> {
  return chrome.runtime.sendMessage(request);
}

async function insertPrompt(promptId: string): Promise<void> {
  const result = await runtime({ type: "prompt:get", promptId });
  if (!result.ok || typeof result.value !== "string") return;
  adapter.insertComposerText(result.value);
}

function buildComposerControls(): HTMLElement {
  const root = document.createElement("div");
  root.className = "atlas-extension-menu";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "atlas-extension-toggle";
  toggle.textContent = "ATLAS";
  toggle.setAttribute("aria-label", "Open ATLAS workflow prompts");
  const menu = document.createElement("div");
  menu.className = "atlas-extension-options";
  menu.hidden = true;
  for (const [label, promptId] of promptModes) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => {
      menu.hidden = true;
      void insertPrompt(promptId);
    });
    menu.append(button);
  }
  toggle.addEventListener("click", () => {
    menu.hidden = !menu.hidden;
  });
  root.append(toggle, menu);
  return root;
}

async function runAction(
  message: HTMLElement,
  action: AtlasAction,
): Promise<void> {
  if (action.kind === "copy_prompt") {
    await navigator.clipboard.writeText(action.prompt);
    return;
  }
  if (action.kind === "compose") {
    adapter.insertComposerText(action.prompt);
    return;
  }
  if (!(await adapter.branchInNewChat(message))) return;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (adapter.insertComposerText(action.prompt)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function buildActionControls(
  message: HTMLElement,
  actions: AtlasAction[],
): HTMLElement {
  const root = document.createElement("div");
  root.className = "atlas-extension-actions";
  for (const action of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    button.dataset.atlasActionId = action.id;
    button.addEventListener("click", () => void runAction(message, action));
    root.append(button);
  }
  return root;
}

function reconcile(): void {
  if (adapter.probeCompatibility().composer) {
    adapter.mountComposerControls(buildComposerControls());
  }
  for (const message of adapter.assistantMessages()) {
    if (message.querySelector('[data-atlas-extension-root="message-actions"]'))
      continue;
    const parsed = parseAtlasActions(message.innerText);
    if (!parsed) continue;
    adapter.mountMessageActions(
      message,
      buildActionControls(message, parsed.actions),
    );
  }
}

let scheduled = false;
function scheduleReconcile(): void {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    reconcile();
  });
}

new MutationObserver(scheduleReconcile).observe(document.documentElement, {
  childList: true,
  subtree: true,
});
window.addEventListener("popstate", scheduleReconcile);
scheduleReconcile();
