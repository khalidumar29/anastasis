// GENERATED ZONE: one test per spec workflow (derived from trigger/effect),
// plus one migration-fidelity test per entity (row count in DB equals
// row_count_expected from the migration_plan).
// Tests run against the server at process.env.BASE_URL via `npm run smoke`.
import test from "node:test";
import assert from "node:assert/strict";

test("app has not been generated yet", () => {
  assert.fail("smoke.test.ts must be generated from spec/product-spec.json");
});
