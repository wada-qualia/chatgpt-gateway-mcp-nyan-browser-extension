import Ajv from "ajv";

import { atlasActionsSchema } from "./actionSchema";
import type { AtlasActionsEnvelope } from "./types";

const ajv = new Ajv({ allErrors: true, strict: true });
const validate = ajv.compile(atlasActionsSchema);
const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);
const blockPattern = /```atlas-actions\s*\n([\s\S]*?)\n```/g;

function hasForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenKey);
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, nested]) => forbiddenKeys.has(key) || hasForbiddenKey(nested),
  );
}

export function parseAtlasActions(text: string): AtlasActionsEnvelope | null {
  if (text.length > 128_000) return null;
  const matches = [...text.matchAll(blockPattern)];
  if (matches.length !== 1) return null;
  const raw = matches[0]?.[1];
  if (!raw || raw.length > 64_000) return null;

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (hasForbiddenKey(decoded) || !validate(decoded)) return null;

  const envelope = decoded as AtlasActionsEnvelope;
  const ids = new Set<string>();
  for (const action of envelope.actions) {
    if (ids.has(action.id)) return null;
    ids.add(action.id);
    if (/https?:\/\//i.test(action.prompt)) return null;
  }
  return envelope;
}
