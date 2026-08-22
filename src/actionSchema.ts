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
