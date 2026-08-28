import { describe, expect, it } from "vitest";

import {
  CHAT_CONTEXT_SESSION_KEY,
  ChatContextCoordinator,
  ChatContextSessionStore,
  fingerprintConversationRef,
  parseChatContextBinding,
  parseChatContextLease,
  parseRuntimeChatContextLease,
  renderChatContextBootstrap,
  type ChatContextGateway,
  type ChatContextLease,
  type ChatContextStorageArea,
} from "../src/chatContext";

function lease(contextId: string, chatContext: string): ChatContextLease {
  return {
    contextId,
    chatContext,
    generation: 1,
    expiresAt: "2026-08-29T01:00:00Z",
  };
}

function memoryStorage(initial: Record<string, unknown> = {}): {
  area: ChatContextStorageArea;
  snapshot: () => Record<string, unknown>;
} {
  const values: Record<string, unknown> = structuredClone(initial);
  return {
    area: {
      get(keys) {
        if (typeof keys === "string") {
          return Promise.resolve(
            keys in values ? { [keys]: structuredClone(values[keys]) } : {},
          );
        }
        if (Array.isArray(keys)) {
          return Promise.resolve(
            Object.fromEntries(
              keys
                .filter((key) => key in values)
                .map((key) => [key, structuredClone(values[key])]),
            ),
          );
        }
        return Promise.resolve(structuredClone(values));
      },
      set(items) {
        Object.assign(values, structuredClone(items));
        return Promise.resolve();
      },
      remove(keys) {
        for (const key of Array.isArray(keys) ? keys : [keys])
          delete values[key];
        return Promise.resolve();
      },
    },
    snapshot: () => structuredClone(values),
  };
}

function gatewayFixture(): {
  gateway: ChatContextGateway;
  created: Array<{ clientNonce: string; projectRef: string }>;
  bound: Array<{ contextId: string; conversationRef: string }>;
  resolved: string[];
} {
  const byNonce = new Map<string, ChatContextLease>();
  let counter = 0;
  const created: Array<{ clientNonce: string; projectRef: string }> = [];
  const bound: Array<{ contextId: string; conversationRef: string }> = [];
  const resolved: string[] = [];
  return {
    created,
    bound,
    resolved,
    gateway: {
      createChatContext(input) {
        created.push(input);
        const existing = byNonce.get(input.clientNonce);
        if (existing) return Promise.resolve(existing);
        counter += 1;
        const value = lease(
          `context-${counter}`,
          counter === 1 ? "A1b2" : counter === 2 ? "C3d4" : "E5f6",
        );
        byNonce.set(input.clientNonce, value);
        return Promise.resolve(value);
      },
      bindChatContext(contextId, conversationRef) {
        bound.push({ contextId, conversationRef });
        return Promise.resolve({ contextId, keyVersion: 1, newlyBound: true });
      },
      resolveChatContext(conversationRef) {
        resolved.push(conversationRef);
        return Promise.resolve(
          conversationRef === "existing-conversation"
            ? lease("context-existing", "Z9y8")
            : null,
        );
      },
    },
  };
}

describe("chat context runtime", () => {
  it("allocates distinct provisional contexts per tab and reuses the nonce after worker restart", async () => {
    const storage = memoryStorage();
    const fixture = gatewayFixture();
    const nonces = ["nonce-tab-1", "nonce-tab-2"];
    const store = new ChatContextSessionStore(
      storage.area,
      () => nonces.shift()!,
    );
    const coordinator = new ChatContextCoordinator(store, fixture.gateway);

    const [first, second] = await Promise.all([
      coordinator.ensure(41, "g-p-alpha"),
      coordinator.ensure(42, "g-p-alpha"),
    ]);
    expect(first).toMatchObject({
      contextId: "context-1",
      chatContext: "A1b2",
    });
    expect(second).toMatchObject({
      contextId: "context-2",
      chatContext: "C3d4",
    });
    expect(first.contextId).not.toBe(second.contextId);
    const persisted = JSON.stringify(
      storage.snapshot()[CHAT_CONTEXT_SESSION_KEY],
    );
    expect(persisted).toContain('"41"');
    expect(persisted).toContain('"42"');

    const restartedStore = new ChatContextSessionStore(
      storage.area,
      () => "must-not-be-used",
    );
    const restarted = new ChatContextCoordinator(
      restartedStore,
      fixture.gateway,
    );
    await expect(restarted.ensure(41, "g-p-alpha")).resolves.toEqual(first);
    expect(fixture.created.map((item) => item.clientNonce)).toEqual([
      "nonce-tab-1",
      "nonce-tab-2",
      "nonce-tab-1",
    ]);
  });

  it("binds a provisional context, stores only a fingerprint, and creates a new context after returning to new chat", async () => {
    const storage = memoryStorage();
    const fixture = gatewayFixture();
    const nonces = ["nonce-first", "nonce-next"];
    const coordinator = new ChatContextCoordinator(
      new ChatContextSessionStore(storage.area, () => nonces.shift()!),
      fixture.gateway,
    );
    const provisional = await coordinator.ensure(7, "g-p-alpha");
    const rawConversation = "conversation-sensitive-raw-id";

    await expect(
      coordinator.bind(7, "g-p-alpha", rawConversation),
    ).resolves.toEqual(provisional);
    expect(fixture.bound).toEqual([
      { contextId: provisional.contextId, conversationRef: rawConversation },
    ]);

    const serialized = JSON.stringify(storage.snapshot());
    expect(serialized).not.toContain(rawConversation);
    expect(serialized).toContain(
      await fingerprintConversationRef(rawConversation),
    );

    const restarted = new ChatContextCoordinator(
      new ChatContextSessionStore(storage.area, () => nonces.shift()!),
      fixture.gateway,
    );
    await expect(
      restarted.bind(7, "g-p-alpha", rawConversation),
    ).resolves.toEqual(provisional);
    expect(fixture.bound).toHaveLength(1);

    const next = await restarted.ensure(7, "g-p-alpha");
    expect(next.contextId).toBe("context-2");
    expect(next.contextId).not.toBe(provisional.contextId);
    expect(fixture.created.at(-1)?.clientNonce).toBe("nonce-next");
  });

  it("resolves a direct-open existing conversation without creating or binding a provisional context", async () => {
    const storage = memoryStorage();
    const fixture = gatewayFixture();
    const coordinator = new ChatContextCoordinator(
      new ChatContextSessionStore(storage.area, () => "unused-nonce"),
      fixture.gateway,
    );

    const resolved = await coordinator.bind(
      9,
      "g-p-alpha",
      "existing-conversation",
    );
    expect(resolved).toMatchObject({
      contextId: "context-existing",
      chatContext: "Z9y8",
    });
    expect(fixture.created).toEqual([]);
    expect(fixture.bound).toEqual([]);
    expect(fixture.resolved).toEqual(["existing-conversation"]);
    expect(JSON.stringify(storage.snapshot())).not.toContain(
      "existing-conversation",
    );
  });

  it("clears all tab mappings from session storage", async () => {
    const storage = memoryStorage({
      [CHAT_CONTEXT_SESSION_KEY]: {
        version: 1,
        tabs: { "1": { projectId: "g-p-alpha", clientNonce: "nonce" } },
      },
    });
    const store = new ChatContextSessionStore(storage.area);
    await store.clear();
    expect(storage.snapshot()).not.toHaveProperty(CHAT_CONTEXT_SESSION_KEY);
  });

  it("validates Gateway/runtime payloads and renders the model-visible bootstrap stanza", () => {
    const parsed = parseChatContextLease({
      context_id: "context-1",
      chat_context: "A1b2",
      generation: 2,
      expires_at: "2026-08-29T01:00:00Z",
    });
    expect(parseRuntimeChatContextLease(parsed)).toEqual(parsed);
    expect(
      parseChatContextBinding({
        context_id: "context-1",
        key_version: 3,
        newly_bound: false,
      }),
    ).toEqual({ contextId: "context-1", keyVersion: 3, newlyBound: false });
    expect(renderChatContextBootstrap("Project bootstrap", parsed)).toContain(
      'Pass chat_context="A1b2" to every ATLAS tool call',
    );
    expect(() =>
      parseRuntimeChatContextLease({ ...parsed, chatContext: "bad!" }),
    ).toThrow("Invalid runtime chat context lease");
  });
});
