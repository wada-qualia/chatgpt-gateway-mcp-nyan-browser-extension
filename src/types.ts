import type { ExtensionSettings } from "./settings";

export type PromptManifest = {
  schema_version: 1;
  channel: string;
  release_id: string;
  generation: number;
  release_generation: number;
  bundle_id: string;
  sha256: string;
  etag: string;
  cache_scope_id: string;
  max_stale_seconds: number;
};

export type PromptItem = {
  id: string;
  version: number;
  content: string;
  content_type: string;
  variables_schema: Record<string, unknown>;
  sha256: string;
};

export type PromptBundle = {
  schema_version: 1;
  release_id: string;
  generation: number;
  prompts: PromptItem[];
  sha256?: string;
};

export type CachedPromptBundle = {
  manifest: PromptManifest;
  bundle: PromptBundle;
  bundleEtag: string;
  validatedAtMs: number;
};

export type ActionKind = "compose" | "branch_and_compose" | "copy_prompt";

export type AtlasAction = {
  id: string;
  label: string;
  kind: ActionKind;
  prompt: string;
  auto_send?: false;
};

export type AtlasActionsEnvelope = {
  schema_version: 1;
  workflow: string;
  actions: AtlasAction[];
};

export type AuthProfile = {
  displayName: string;
};

export type RuntimeRequest =
  | { type: "prompt:get"; promptId: string }
  | { type: "prompt:refresh" }
  | { type: "auth:get-status" }
  | { type: "auth:get-profile" }
  | { type: "auth:login" }
  | { type: "auth:logout" }
  | { type: "chat-context:ensure"; projectId: string }
  | { type: "chat-context:bind"; projectId: string; conversationRef: string }
  | { type: "chat-context:resolve"; projectId: string; conversationRef: string }
  | { type: "settings:get" }
  | { type: "settings:update"; settings: ExtensionSettings };

export type RuntimeResponse =
  | { ok: true; value: unknown }
  | { ok: false; error: string };
