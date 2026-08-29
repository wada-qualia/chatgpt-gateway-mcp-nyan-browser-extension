export const CHAT_CONTEXT_SESSION_KEY = "atlas.chatContexts.v1";

export type ChatContextLease = {
  contextId: string;
  chatContext: string;
  generation: number;
  expiresAt: string;
};

export type ChatContextBinding = {
  contextId: string;
  keyVersion: number;
  newlyBound: boolean;
};

export type ChatContextTabSession = {
  projectId: string;
  clientNonce?: string;
  context?: ChatContextLease;
  conversationFingerprint?: string;
};

type ChatContextSessionState = {
  version: 1;
  tabs: Record<string, ChatContextTabSession>;
};

export type ChatContextStorageArea = {
  get(
    keys?: string | string[] | Record<string, unknown> | null,
  ): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
};

export type ChatContextGateway = {
  createChatContext(input: {
    clientNonce: string;
    projectRef: string;
  }): Promise<ChatContextLease>;
  bindChatContext(
    contextId: string,
    conversationRef: string,
  ): Promise<ChatContextBinding>;
  resolveChatContext(conversationRef: string): Promise<ChatContextLease | null>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isLease(value: unknown): value is ChatContextLease {
  if (!isRecord(value)) return false;
  return (
    typeof value.contextId === "string" &&
    value.contextId.length > 0 &&
    value.contextId.length <= 64 &&
    typeof value.chatContext === "string" &&
    /^[A-Za-z0-9]{4}$/u.test(value.chatContext) &&
    Number.isInteger(value.generation) &&
    Number(value.generation) >= 1 &&
    typeof value.expiresAt === "string" &&
    Number.isFinite(Date.parse(value.expiresAt))
  );
}

function isTabSession(value: unknown): value is ChatContextTabSession {
  if (
    !isRecord(value) ||
    typeof value.projectId !== "string" ||
    !value.projectId
  ) {
    return false;
  }
  if (
    value.clientNonce !== undefined &&
    (typeof value.clientNonce !== "string" || !value.clientNonce)
  ) {
    return false;
  }
  if (value.context !== undefined && !isLease(value.context)) return false;
  if (
    value.conversationFingerprint !== undefined &&
    (typeof value.conversationFingerprint !== "string" ||
      !/^[0-9a-f]{64}$/u.test(value.conversationFingerprint))
  ) {
    return false;
  }
  return true;
}

function parseState(value: unknown): ChatContextSessionState {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.tabs)) {
    return { version: 1, tabs: {} };
  }
  const tabs: Record<string, ChatContextTabSession> = {};
  for (const [key, entry] of Object.entries(value.tabs)) {
    if (/^\d+$/u.test(key) && isTabSession(entry)) tabs[key] = entry;
  }
  return { version: 1, tabs };
}

export function parseChatContextLease(value: unknown): ChatContextLease {
  if (!isRecord(value)) throw new Error("Invalid chat context lease response");
  const normalized = {
    contextId: value.context_id,
    chatContext: value.chat_context,
    generation: value.generation,
    expiresAt: value.expires_at,
  };
  if (!isLease(normalized)) {
    throw new Error("Invalid chat context lease response");
  }
  return normalized;
}

export function parseRuntimeChatContextLease(value: unknown): ChatContextLease {
  if (!isLease(value)) {
    throw new Error("Invalid runtime chat context lease");
  }
  return value;
}

export function parseChatContextBinding(value: unknown): ChatContextBinding {
  if (!isRecord(value))
    throw new Error("Invalid chat context binding response");
  const contextId = value.context_id;
  const keyVersion = value.key_version;
  const newlyBound = value.newly_bound;
  if (
    typeof contextId !== "string" ||
    !contextId ||
    contextId.length > 64 ||
    !Number.isInteger(keyVersion) ||
    Number(keyVersion) < 1 ||
    typeof newlyBound !== "boolean"
  ) {
    throw new Error("Invalid chat context binding response");
  }
  return { contextId, keyVersion: Number(keyVersion), newlyBound };
}

export function renderChatContextBootstrap(
  prompt: string,
  context: ChatContextLease,
): string {
  const base = prompt.trimEnd();
  const stanza = [
    `ATLAS chat context: ${context.chatContext}`,
    `Pass chat_context="${context.chatContext}" to every ATLAS tool call in this conversation.`,
    "This value identifies the conversation context and is not an authentication credential.",
    "If ATLAS reports CHAT_CONTEXT_REQUIRED or CHAT_CONTEXT_EXPIRED, use the recovery tool named in the error and retry the original tool call.",
  ].join("\n");
  return base ? `${base}\n\n${stanza}` : stanza;
}

export async function fingerprintConversationRef(
  value: string,
): Promise<string> {
  if (!value || value.length > 512)
    throw new Error("Invalid conversation reference");
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export class ChatContextSessionStore {
  private operationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: ChatContextStorageArea,
    private readonly nonceFactory: () => string = () =>
      globalThis.crypto.randomUUID(),
  ) {}

  private async load(): Promise<ChatContextSessionState> {
    const raw = await this.storage.get(CHAT_CONTEXT_SESSION_KEY);
    return parseState(raw[CHAT_CONTEXT_SESSION_KEY]);
  }

  private async save(state: ChatContextSessionState): Promise<void> {
    await this.storage.set({ [CHAT_CONTEXT_SESSION_KEY]: state });
  }

  private sequence<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  getTab(tabId: number): Promise<ChatContextTabSession | null> {
    return this.sequence(async () => {
      const state = await this.load();
      return state.tabs[String(tabId)] ?? null;
    });
  }

  prepareProvisional(
    tabId: number,
    projectId: string,
  ): Promise<ChatContextTabSession> {
    return this.sequence(async () => {
      const state = await this.load();
      const key = String(tabId);
      const current = state.tabs[key];
      if (
        current?.projectId === projectId &&
        current.clientNonce &&
        !current.conversationFingerprint
      ) {
        return current;
      }
      const entry: ChatContextTabSession = {
        projectId,
        clientNonce: this.nonceFactory(),
      };
      state.tabs[key] = entry;
      await this.save(state);
      return entry;
    });
  }

  saveProvisionalContext(
    tabId: number,
    projectId: string,
    clientNonce: string,
    context: ChatContextLease,
  ): Promise<void> {
    return this.sequence(async () => {
      const state = await this.load();
      state.tabs[String(tabId)] = { projectId, clientNonce, context };
      await this.save(state);
    });
  }

  saveBoundContext(
    tabId: number,
    projectId: string,
    context: ChatContextLease,
    conversationFingerprint: string,
  ): Promise<void> {
    return this.sequence(async () => {
      const state = await this.load();
      state.tabs[String(tabId)] = {
        projectId,
        context,
        conversationFingerprint,
      };
      await this.save(state);
    });
  }

  clear(): Promise<void> {
    return this.sequence(() => this.storage.remove(CHAT_CONTEXT_SESSION_KEY));
  }
}

export class ChatContextCoordinator {
  constructor(
    private readonly store: ChatContextSessionStore,
    private readonly gateway: ChatContextGateway,
  ) {}

  async ensure(tabId: number, projectId: string): Promise<ChatContextLease> {
    const entry = await this.store.prepareProvisional(tabId, projectId);
    if (!entry.clientNonce)
      throw new Error("Chat context nonce is unavailable");
    const context = await this.gateway.createChatContext({
      clientNonce: entry.clientNonce,
      projectRef: projectId,
    });
    await this.store.saveProvisionalContext(
      tabId,
      projectId,
      entry.clientNonce,
      context,
    );
    return context;
  }

  async bind(
    tabId: number,
    projectId: string,
    conversationRef: string,
  ): Promise<ChatContextLease | null> {
    const fingerprint = await fingerprintConversationRef(conversationRef);
    const current = await this.store.getTab(tabId);
    if (
      current?.projectId === projectId &&
      current.context &&
      current.conversationFingerprint === fingerprint
    ) {
      return current.context;
    }
    if (
      current?.projectId === projectId &&
      current.context &&
      !current.conversationFingerprint
    ) {
      await this.gateway.bindChatContext(
        current.context.contextId,
        conversationRef,
      );
      await this.store.saveBoundContext(
        tabId,
        projectId,
        current.context,
        fingerprint,
      );
      return current.context;
    }
    const resolved = await this.gateway.resolveChatContext(conversationRef);
    if (!resolved) return null;
    await this.store.saveBoundContext(tabId, projectId, resolved, fingerprint);
    return resolved;
  }

  async resolve(
    tabId: number,
    projectId: string,
    conversationRef: string,
  ): Promise<ChatContextLease | null> {
    const fingerprint = await fingerprintConversationRef(conversationRef);
    const current = await this.store.getTab(tabId);
    if (
      current?.projectId === projectId &&
      current.context &&
      current.conversationFingerprint === fingerprint
    ) {
      return current.context;
    }
    const resolved = await this.gateway.resolveChatContext(conversationRef);
    if (!resolved) return null;
    await this.store.saveBoundContext(tabId, projectId, resolved, fingerprint);
    return resolved;
  }
}
