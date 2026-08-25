type JsonSchemaNode = {
  readonly $id?: string;
  readonly type?: "object" | "array" | "string";
  readonly additionalProperties?: boolean;
  readonly required?: readonly string[];
  readonly properties?: Readonly<Record<string, JsonSchemaNode>>;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly enum?: readonly unknown[];
  readonly const?: unknown;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly items?: JsonSchemaNode;
};

export const atlasActionsSchema = {
  $id: "https://example.com/contracts/chatgpt-extension/v1/atlas-actions.schema.json",
  type: "object",
  additionalProperties: false,
  required: ["schema_version", "workflow", "actions"],
  properties: {
    schema_version: { const: 1 },
    workflow: { type: "string", minLength: 1, maxLength: 128 },
    actions: {
      type: "array",
      minItems: 1,
      maxItems: 16,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "kind", "prompt"],
        properties: {
          id: {
            type: "string",
            pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          },
          label: { type: "string", minLength: 1, maxLength: 160 },
          kind: { enum: ["compose", "branch_and_compose", "copy_prompt"] },
          prompt: { type: "string", minLength: 1, maxLength: 12000 },
          auto_send: { const: false },
        },
      },
    },
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateSchema(schema: JsonSchemaNode, value: unknown): boolean {
  if ("const" in schema && !Object.is(value, schema.const)) return false;
  if (
    schema.enum &&
    !schema.enum.some((candidate) => Object.is(candidate, value))
  ) {
    return false;
  }

  if (schema.type === "string") {
    if (typeof value !== "string") return false;
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength)
      return false;
    if (schema.maxLength !== undefined && length > schema.maxLength)
      return false;
    if (
      schema.pattern !== undefined &&
      !new RegExp(schema.pattern, "u").test(value)
    ) {
      return false;
    }
  }

  if (schema.type === "array") {
    if (!Array.isArray(value)) return false;
    if (schema.minItems !== undefined && value.length < schema.minItems)
      return false;
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      return false;
    const itemSchema = schema.items;
    if (
      itemSchema &&
      !value.every((item) => validateSchema(itemSchema, item))
    ) {
      return false;
    }
  }

  if (schema.type === "object") {
    if (!isRecord(value)) return false;
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) return false;
    }
    if (
      schema.additionalProperties === false &&
      Object.keys(value).some(
        (key) => !Object.prototype.hasOwnProperty.call(properties, key),
      )
    ) {
      return false;
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (
        Object.prototype.hasOwnProperty.call(value, key) &&
        !validateSchema(propertySchema, value[key])
      ) {
        return false;
      }
    }
  }

  return true;
}

export function validateAtlasActionsSchema(value: unknown): boolean {
  return validateSchema(atlasActionsSchema, value);
}
