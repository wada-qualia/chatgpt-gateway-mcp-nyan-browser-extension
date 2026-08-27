import { parseAtlasActions } from "./actions";
import { ChatGptDomAdapter } from "./domAdapter";
import {
  MAX_PROJECTS,
  defaultExtensionSettings,
  parseExtensionSettings,
  renderBootstrapPrompt,
  type ExtensionSettings,
} from "./settings";
import type {
  AtlasAction,
  AuthProfile,
  RuntimeRequest,
  RuntimeResponse,
} from "./types";

const adapter = new ChatGptDomAdapter();
const CLOSE_OVERLAYS_EVENT = "atlas-extension-close-overlays";
const promptModes: Array<[string, string]> = [
  ["Takeoff", "takeoff"],
  ["Plan", "plan"],
  ["Phases", "phases"],
  ["Current phase", "current_phase"],
];
const bootstrapInFlight = new WeakSet<HTMLElement>();
const bootstrapApplied = new WeakSet<HTMLElement>();

async function runtime(request: RuntimeRequest): Promise<RuntimeResponse> {
  return chrome.runtime.sendMessage(request);
}

async function insertPrompt(promptId: string): Promise<void> {
  const result = await runtime({ type: "prompt:get", promptId });
  if (!result.ok || typeof result.value !== "string") return;
  adapter.insertComposerText(result.value);
}

async function maybeBootstrapSelectedProjects(): Promise<void> {
  const composer = adapter.resolveComposer();
  if (
    !composer ||
    bootstrapApplied.has(composer) ||
    bootstrapInFlight.has(composer) ||
    !adapter.isEmptyConversation()
  ) {
    return;
  }
  bootstrapInFlight.add(composer);
  try {
    const result = await runtime({ type: "settings:get" });
    if (!result.ok) return;
    const settings = parseExtensionSettings(result.value);
    const prompt = renderBootstrapPrompt(settings);
    if (!prompt) return;
    if (
      adapter.resolveComposer() !== composer ||
      !adapter.isEmptyConversation()
    ) {
      return;
    }
    if (adapter.insertComposerText(prompt)) bootstrapApplied.add(composer);
  } catch {
    // Automatic bootstrap is best-effort and must not interfere with ChatGPT.
  } finally {
    bootstrapInFlight.delete(composer);
  }
}

function authProfile(value: unknown): AuthProfile | null {
  if (value === null) return null;
  if (value === null || typeof value !== "object") return null;
  const displayName = (value as Record<string, unknown>).displayName;
  if (typeof displayName !== "string" || !displayName.trim()) return null;
  return { displayName: displayName.trim() };
}

function createButton(label: string, className?: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  if (className) button.className = className;
  return button;
}

function buildComposerControls(): HTMLElement {
  const root = document.createElement("div");
  root.className = "atlas-extension-menu";

  const toggle = createButton("A", "atlas-extension-toggle");
  toggle.title = "ATLAS";
  toggle.setAttribute("aria-label", "Open ATLAS workflow prompts");
  toggle.setAttribute("aria-haspopup", "menu");
  toggle.setAttribute("aria-expanded", "false");

  const menu = document.createElement("div");
  menu.className = "atlas-extension-options";
  menu.setAttribute("role", "menu");
  menu.hidden = true;

  const userSubmenu = document.createElement("div");
  userSubmenu.className = "atlas-extension-user-submenu";
  userSubmenu.setAttribute("role", "menu");
  userSubmenu.hidden = true;

  const settingsBackdrop = document.createElement("div");
  settingsBackdrop.className = "atlas-extension-settings-backdrop";
  settingsBackdrop.hidden = true;

  const setMenuOpen = (open: boolean): void => {
    menu.hidden = !open;
    if (!open) userSubmenu.hidden = true;
    toggle.setAttribute("aria-expanded", String(open));
  };
  const setSettingsOpen = (open: boolean): void => {
    settingsBackdrop.hidden = !open;
    if (open) setMenuOpen(false);
  };
  const closeOverlays = (): void => {
    setMenuOpen(false);
    setSettingsOpen(false);
  };
  root.addEventListener(CLOSE_OVERLAYS_EVENT, closeOverlays);

  for (const [label, promptId] of promptModes) {
    const button = createButton(label);
    button.setAttribute("role", "menuitem");
    button.addEventListener("click", () => {
      setMenuOpen(false);
      void insertPrompt(promptId);
    });
    menu.append(button);
  }

  const settingsButton = createButton(
    "⚙ Settings",
    "atlas-extension-settings-button",
  );
  settingsButton.setAttribute("role", "menuitem");
  menu.append(settingsButton);

  const authSection = document.createElement("div");
  authSection.className = "atlas-extension-auth-section";

  const signInButton = createButton("Sign in", "atlas-extension-auth");
  signInButton.dataset.atlasAuthControl = "true";
  signInButton.setAttribute("role", "menuitem");
  signInButton.setAttribute("aria-label", "Sign in to ATLAS Gateway");

  const accountWrap = document.createElement("div");
  accountWrap.className = "atlas-extension-account-wrap";
  accountWrap.hidden = true;
  const accountButton = createButton("", "atlas-extension-account");
  accountButton.dataset.atlasAuthControl = "true";
  accountButton.setAttribute("role", "menuitem");
  accountButton.setAttribute("aria-haspopup", "menu");
  accountButton.setAttribute("aria-expanded", "false");
  const userIcon = document.createElement("span");
  userIcon.className = "atlas-extension-user-icon";
  userIcon.setAttribute("aria-hidden", "true");
  userIcon.textContent = "👤";
  const userName = document.createElement("span");
  userName.className = "atlas-extension-user-name";
  const userChevron = document.createElement("span");
  userChevron.className = "atlas-extension-user-chevron";
  userChevron.setAttribute("aria-hidden", "true");
  userChevron.textContent = "›";
  accountButton.append(userIcon, userName, userChevron);

  const signOutButton = createButton("Sign out", "atlas-extension-signout");
  signOutButton.setAttribute("role", "menuitem");
  userSubmenu.append(signOutButton);
  accountWrap.append(accountButton, userSubmenu);
  authSection.append(signInButton, accountWrap);
  menu.append(authSection);

  const refreshAuthControls = async (): Promise<void> => {
    const response = await runtime({ type: "auth:get-profile" });
    if (!response.ok) {
      signInButton.title = response.error;
      return;
    }
    const profile = authProfile(response.value);
    const signedIn = profile !== null;
    signInButton.hidden = signedIn;
    accountWrap.hidden = !signedIn;
    userSubmenu.hidden = true;
    accountButton.setAttribute("aria-expanded", "false");
    if (profile) {
      userName.textContent = profile.displayName;
      accountButton.setAttribute(
        "aria-label",
        `ATLAS account ${profile.displayName}`,
      );
      accountButton.title = profile.displayName;
    } else {
      userName.textContent = "";
      accountButton.removeAttribute("title");
    }
  };

  signInButton.addEventListener("click", () => {
    void (async () => {
      const result = await runtime({ type: "auth:login" });
      if (!result.ok) {
        signInButton.title = result.error;
        return;
      }
      await refreshAuthControls();
    })();
  });

  accountButton.addEventListener("click", () => {
    const open = userSubmenu.hidden;
    userSubmenu.hidden = !open;
    accountButton.setAttribute("aria-expanded", String(open));
  });

  signOutButton.addEventListener("click", () => {
    void (async () => {
      const result = await runtime({ type: "auth:logout" });
      if (!result.ok) {
        signOutButton.title = result.error;
        return;
      }
      userSubmenu.hidden = true;
      await refreshAuthControls();
    })();
  });

  const settingsDialog = document.createElement("section");
  settingsDialog.className = "atlas-extension-settings-dialog";
  settingsDialog.setAttribute("role", "dialog");
  settingsDialog.setAttribute("aria-modal", "true");
  settingsDialog.setAttribute(
    "aria-labelledby",
    "atlas-extension-settings-title",
  );

  const settingsHeader = document.createElement("header");
  settingsHeader.className = "atlas-extension-settings-header";
  const settingsTitle = document.createElement("h2");
  settingsTitle.id = "atlas-extension-settings-title";
  settingsTitle.textContent = "ATLAS settings";
  const settingsClose = createButton("×", "atlas-extension-settings-close");
  settingsClose.setAttribute("aria-label", "Close ATLAS settings");
  settingsHeader.append(settingsTitle, settingsClose);

  const settingsBody = document.createElement("div");
  settingsBody.className = "atlas-extension-settings-body";
  const settingsHint = document.createElement("p");
  settingsHint.className = "atlas-extension-settings-hint";
  settingsHint.textContent =
    "Choose one or more projects already visible in the ChatGPT sidebar. Opening them in an empty chat prefills the bootstrap prompt but never sends it automatically.";

  const projectsTitle = document.createElement("h3");
  projectsTitle.textContent = "Projects";
  const projectList = document.createElement("div");
  projectList.className = "atlas-extension-project-list";
  const addProjectRow = document.createElement("div");
  addProjectRow.className = "atlas-extension-project-add";
  const projectSelect = document.createElement("select");
  projectSelect.className = "atlas-extension-project-select";
  projectSelect.setAttribute("aria-label", "ChatGPT project");
  const addProjectButton = createButton("Add project");
  addProjectButton.disabled = true;
  addProjectRow.append(projectSelect, addProjectButton);

  const promptLabel = document.createElement("label");
  promptLabel.className = "atlas-extension-bootstrap-label";
  promptLabel.textContent = "Bootstrap prompt";
  const bootstrapPrompt = document.createElement("textarea");
  bootstrapPrompt.className = "atlas-extension-bootstrap-prompt";
  bootstrapPrompt.rows = 10;
  bootstrapPrompt.setAttribute("aria-label", "Project bootstrap prompt");
  const promptHint = document.createElement("p");
  promptHint.className = "atlas-extension-settings-hint";
  promptHint.textContent =
    "Use {{projects}} where selected project names should be inserted. The current security boundary does not use hidden/private ChatGPT prompts, so this text is placed visibly into an empty composer.";

  const settingsStatus = document.createElement("p");
  settingsStatus.className = "atlas-extension-settings-status";
  settingsStatus.setAttribute("role", "status");
  settingsStatus.setAttribute("aria-live", "polite");

  settingsBody.append(
    settingsHint,
    projectsTitle,
    projectList,
    addProjectRow,
    promptLabel,
    bootstrapPrompt,
    promptHint,
    settingsStatus,
  );

  const settingsFooter = document.createElement("footer");
  settingsFooter.className = "atlas-extension-settings-footer";
  const saveSettingsButton = createButton("Save");
  const openProjectsButton = createButton(
    "Open selected project(s)",
    "atlas-extension-primary",
  );
  settingsFooter.append(saveSettingsButton, openProjectsButton);
  settingsDialog.append(settingsHeader, settingsBody, settingsFooter);
  settingsBackdrop.append(settingsDialog);

  let settingsDraft: ExtensionSettings = defaultExtensionSettings();
  let nativeProjectOptions = adapter.nativeProjects();

  const refreshNativeProjectOptions = (): void => {
    nativeProjectOptions = adapter.nativeProjects();
    const configuredIds = new Set(
      settingsDraft.projects.map((project) => project.id),
    );
    const configuredNames = new Set(
      settingsDraft.projects.map((project) => project.name.toLocaleLowerCase()),
    );
    const available = nativeProjectOptions.filter(
      (project) =>
        !configuredIds.has(project.id) &&
        !configuredNames.has(project.name.toLocaleLowerCase()),
    );
    projectSelect.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.textContent =
      available.length > 0
        ? "Select a ChatGPT project"
        : "No unconfigured projects visible in ChatGPT sidebar";
    projectSelect.append(placeholder);
    for (const project of available) {
      const option = document.createElement("option");
      option.value = project.id;
      option.textContent = project.name;
      projectSelect.append(option);
    }
    projectSelect.disabled = available.length === 0;
    addProjectButton.disabled = true;
  };

  const renderProjectList = (): void => {
    projectList.replaceChildren();
    if (settingsDraft.projects.length === 0) {
      const empty = document.createElement("p");
      empty.className = "atlas-extension-project-empty";
      empty.textContent = "No projects configured yet.";
      projectList.append(empty);
      return;
    }
    for (const project of settingsDraft.projects) {
      const row = document.createElement("div");
      row.className = "atlas-extension-project-row";
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = settingsDraft.selectedProjectIds.includes(project.id);
      checkbox.addEventListener("change", () => {
        const selected = new Set(settingsDraft.selectedProjectIds);
        if (checkbox.checked) selected.add(project.id);
        else selected.delete(project.id);
        settingsDraft = {
          ...settingsDraft,
          selectedProjectIds: [...selected],
        };
      });
      const name = document.createElement("span");
      name.textContent = project.name;
      label.append(checkbox, name);
      const remove = createButton("Remove", "atlas-extension-project-remove");
      remove.setAttribute("aria-label", `Remove project ${project.name}`);
      remove.addEventListener("click", () => {
        settingsDraft = {
          ...settingsDraft,
          projects: settingsDraft.projects.filter(
            (item) => item.id !== project.id,
          ),
          selectedProjectIds: settingsDraft.selectedProjectIds.filter(
            (id) => id !== project.id,
          ),
        };
        renderProjectList();
        refreshNativeProjectOptions();
      });
      row.append(label, remove);
      projectList.append(row);
    }
  };

  const addProject = (): void => {
    const selectedId = projectSelect.value;
    const project = nativeProjectOptions.find((item) => item.id === selectedId);
    if (!project) {
      settingsStatus.textContent =
        "Select a project currently visible in the ChatGPT sidebar.";
      return;
    }
    if (settingsDraft.projects.length >= MAX_PROJECTS) {
      settingsStatus.textContent = `ATLAS supports up to ${MAX_PROJECTS} configured projects.`;
      return;
    }
    if (
      settingsDraft.projects.some(
        (item) =>
          item.id === project.id ||
          item.name.toLocaleLowerCase() === project.name.toLocaleLowerCase(),
      )
    ) {
      settingsStatus.textContent = "That project is already configured.";
      refreshNativeProjectOptions();
      return;
    }
    settingsDraft = {
      ...settingsDraft,
      projects: [
        ...settingsDraft.projects,
        { id: project.id, name: project.name },
      ],
      selectedProjectIds: [...settingsDraft.selectedProjectIds, project.id],
    };
    settingsStatus.textContent = "";
    renderProjectList();
    refreshNativeProjectOptions();
  };

  addProjectButton.addEventListener("click", addProject);
  projectSelect.addEventListener("change", () => {
    addProjectButton.disabled = projectSelect.value.length === 0;
  });

  const loadSettingsIntoDialog = async (): Promise<boolean> => {
    const result = await runtime({ type: "settings:get" });
    if (!result.ok) {
      settingsStatus.textContent = result.error;
      return false;
    }
    try {
      settingsDraft = parseExtensionSettings(result.value);
    } catch (error) {
      settingsStatus.textContent =
        error instanceof Error ? error.message : "Invalid extension settings";
      return false;
    }
    bootstrapPrompt.value = settingsDraft.bootstrapPrompt;
    settingsStatus.textContent = "";
    renderProjectList();
    refreshNativeProjectOptions();
    return true;
  };

  const persistSettings = async (): Promise<ExtensionSettings | null> => {
    settingsDraft = {
      ...settingsDraft,
      bootstrapPrompt: bootstrapPrompt.value,
    };
    const result = await runtime({
      type: "settings:update",
      settings: settingsDraft,
    });
    if (!result.ok) {
      settingsStatus.textContent = result.error;
      return null;
    }
    try {
      settingsDraft = parseExtensionSettings(result.value);
    } catch {
      settingsStatus.textContent =
        "Gateway returned invalid extension settings.";
      return null;
    }
    settingsStatus.textContent = "Saved.";
    return settingsDraft;
  };

  settingsButton.addEventListener("click", () => {
    void (async () => {
      setSettingsOpen(true);
      await loadSettingsIntoDialog();
      projectSelect.focus();
    })();
  });
  settingsClose.addEventListener("click", () => setSettingsOpen(false));
  settingsBackdrop.addEventListener("click", (event) => {
    if (event.target === settingsBackdrop) setSettingsOpen(false);
  });
  saveSettingsButton.addEventListener("click", () => {
    void persistSettings();
  });
  openProjectsButton.addEventListener("click", () => {
    void (async () => {
      const saved = await persistSettings();
      if (!saved) return;
      const prompt = renderBootstrapPrompt(saved);
      if (!prompt) {
        settingsStatus.textContent =
          "Select at least one project and configure a bootstrap prompt.";
        return;
      }
      if (!adapter.isEmptyConversation()) {
        settingsStatus.textContent =
          "Open a new empty ChatGPT chat before opening the selected project(s). Existing conversation or composer text will not be overwritten.";
        return;
      }
      const composer = adapter.resolveComposer();
      if (!composer || !adapter.insertComposerText(prompt)) {
        settingsStatus.textContent = "ChatGPT composer is not available.";
        return;
      }
      bootstrapApplied.add(composer);
      setSettingsOpen(false);
    })();
  });

  toggle.addEventListener("click", () => {
    if (!adapter.positionComposerControls(root)) {
      setMenuOpen(false);
      return;
    }
    setMenuOpen(menu.hidden);
  });

  root.append(toggle, menu, settingsBackdrop);
  void refreshAuthControls();
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
  const existingComposerControls = document.querySelector<HTMLElement>(
    '[data-atlas-extension-root="composer"]',
  );
  if (existingComposerControls) {
    adapter.positionComposerControls(existingComposerControls);
  } else if (adapter.probeCompatibility().composer) {
    adapter.mountComposerControls(buildComposerControls());
  }
  void maybeBootstrapSelectedProjects();
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

document.addEventListener(
  "pointerdown",
  (event) => {
    const root = document.querySelector<HTMLElement>(
      '[data-atlas-extension-root="composer"]',
    );
    const target = event.target;
    if (root && target instanceof Node && !root.contains(target)) {
      root.dispatchEvent(new CustomEvent(CLOSE_OVERLAYS_EVENT));
    }
  },
  true,
);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  document
    .querySelector<HTMLElement>('[data-atlas-extension-root="composer"]')
    ?.dispatchEvent(new CustomEvent(CLOSE_OVERLAYS_EVENT));
});

new MutationObserver(scheduleReconcile).observe(document.documentElement, {
  childList: true,
  subtree: true,
});
window.addEventListener("popstate", scheduleReconcile);
window.addEventListener("resize", scheduleReconcile);
scheduleReconcile();
