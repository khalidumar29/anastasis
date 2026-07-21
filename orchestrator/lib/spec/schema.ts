import { z } from "zod";

export const FieldType = z.enum([
  "string",
  "text",
  "enum",
  "date",
  "datetime",
  "int",
  "float",
  "bool",
]);

export const Provenance = z.enum(["confirmed", "data_only", "ui_only"]);

export const FieldSpec = z.object({
  name: z.string().describe("snake_case field name, matching the export column when one exists"),
  type: FieldType,
  enum_values: z
    .array(z.string())
    .nullable()
    .describe("Allowed values when type is 'enum', otherwise null"),
  provenance: Provenance,
  verbatim_label: z
    .string()
    .describe("The exact label the user saw on screen for this field"),
  default: z
    .string()
    .nullable()
    .describe("Default or derivation for ui_only fields, otherwise null"),
});

export const EntitySpec = z.object({
  name: z.string().describe("snake_case entity name, used as the table name"),
  fields: z.array(FieldSpec),
});

export const ViewSpec = z.object({
  name: z.string(),
  entity: z.string().describe("Entity this view displays"),
  actions: z
    .array(z.enum(["create", "read", "update", "delete"]))
    .describe("Only the actions the user was seen performing"),
});

export const WorkflowSpec = z.object({
  trigger: z.string().describe("What the user did, e.g. 'drag card from todo to done'"),
  effect: z.string().describe("What happened, e.g. 'task status updates to done'"),
});

export const FieldMapEntry = z.object({
  from: z.string().describe("Column name in the source export file"),
  to: z.string().describe("Field name in the target entity"),
  transform: z
    .string()
    .describe("Transform to apply, e.g. 'copy', 'parse ISO date', 'lowercase'"),
});

export const MigrationPlanEntry = z.object({
  entity: z.string(),
  source_file: z.string().describe("File inside the export ZIP, e.g. 'tasks.csv'"),
  field_map: z.array(FieldMapEntry),
  row_count_expected: z.number().int(),
});

export const ExcludedFeature = z.object({
  feature: z.string(),
  reason: z.string().describe("Why it was excluded, e.g. 'detected but never used in recording'"),
});

export const AnastasisProductSpec = z.object({
  app_name: z.string(),
  entities: z.array(EntitySpec),
  views: z.array(ViewSpec),
  workflows: z.array(WorkflowSpec),
  migration_plan: z.array(MigrationPlanEntry),
  excluded: z.array(ExcludedFeature),
  open_questions: z
    .array(z.string())
    .describe("Ambiguities the pipeline could not resolve from the two inputs"),
});

export type AnastasisProductSpec = z.infer<typeof AnastasisProductSpec>;
export type EntitySpec = z.infer<typeof EntitySpec>;
export type FieldSpec = z.infer<typeof FieldSpec>;
export type ViewSpec = z.infer<typeof ViewSpec>;
export type WorkflowSpec = z.infer<typeof WorkflowSpec>;
export type MigrationPlanEntry = z.infer<typeof MigrationPlanEntry>;
