# AGENTS.md — Anastasis App Generation Rules

You are generating a resurrected application inside a pre-built seed project.
You are a COMPILER, not a designer. Your input is `spec/product-spec.json`
(validated against AnastasisProductSpec schema). Your job is to make this
seed implement that spec exactly — nothing more, nothing less.

## Prime Directives

1. **The spec is law.** Implement every entity, view, and workflow in the
   spec. Implement NOTHING that is not in the spec. No bonus features, no
   "improvements", no extra pages, no settings screens, no auth. If the spec
   doesn't mention it, it does not exist.
2. **The dependency set is fixed.** You may not run `npm install`, add
   dependencies, or modify `package.json` — build every view's UI from
   scratch with plain React + Tailwind using only what's already in
   `package.json`. There is no pre-built component library to compose from
   anymore: write the markup and styling yourself. This is checked
   mechanically, not just by instruction — the build fails before
   `npm run migrate` even runs if `package.json`'s dependencies changed at
   all from the seed.
3. **Do not touch the frozen zones** (listed below). They are infrastructure.
4. **Finish means tests pass.** You are done only when `npm run migrate`
   exits 0 and `npm run smoke` passes every test. Not before.

## File Map — What You Edit vs What Is Frozen

EDIT THESE (your entire working surface):
- `db/schema.sql` — write SQLite DDL for the spec's entities. One table per
  entity. Use TEXT for string/text/enum/date/datetime (ISO 8601 strings for
  dates), INTEGER for int/bool, REAL for float. Every table gets
  `id TEXT PRIMARY KEY`. Enum fields get a CHECK constraint listing
  enum_values from the spec.
- `db/migrate.ts` — implement the migration: read source files from
  `import/` per the spec's migration_plan, apply each field_map transform,
  insert rows. Log a count per table at the end. Idempotent: wipe tables
  before inserting.
- `app/api/[entity]/` — CRUD route handlers per entity, only the actions the
  spec's views declare. No action in spec = no endpoint.
- `app/(views)/` — one page/component per spec view, written entirely from
  scratch with React + Tailwind. The first view in `spec.views` is the app's
  home page (`app/(views)/page.tsx`); other views are reached by navigating
  from it (e.g. clicking a row or list item). If you write your own
  `app/layout.tsx`, it MUST `import "./globals.css"` — that file holds the
  Tailwind directives, and without the import next build emits zero CSS, so
  every Tailwind class in your views silently does nothing (checked
  mechanically: the build fails if the import is missing). Style the views
  to look like a real product: readable spacing, cards/columns, hover
  states — not bare unstyled HTML.
- `lib/labels.ts` — map spec field names to the verbatim UI labels from the
  spec, so the resurrected app shows the words the user actually saw.
- `tests/smoke.test.ts` — one test per spec workflow, derived from
  trigger/effect (e.g. workflow "drag card todo→done / status updates" =>
  test: PATCH status via API, GET confirms). Plus one migration-fidelity
  test per entity: row count in DB equals row_count_expected from the
  migration_plan. Plus one rendered-page check per view: request the view's
  route from the running app and assert the response is a real page (status
  200, not an error/blank page) — this replaces the confidence pre-built
  layout components used to provide, now that every view's markup is custom.

  THE RECORDING IS AN EXAMPLE, NOT A SCRIPT. The user's recorded session
  demonstrates *behaviors*; it is not a transaction log to replay. The
  migrated data comes from the export ZIP, which may not contain records the
  user happened to create or change on camera. Therefore:
  - Tests must NEVER assume a specific record from the recording exists in
    the migrated data (a task titled "demo" the user typed on camera is not
    in the export). Each test creates its own fixture rows, acts on them,
    asserts, and cleans up after itself.
  - Tests must NEVER assert absolute on-screen totals from the recording
    (e.g. "the Done column shows 145"). Those numbers describe one moment of
    a different dataset. Assert relative changes instead: create → count
    goes up by one; delete → down by one. The ONLY absolute counts allowed
    are the migration-fidelity checks against migration_plan.
  - Tests must be order-independent: each one passes when run alone against
    freshly migrated data. Never rely on state left behind by an earlier
    test.
  - After any state-changing call, verify persistence through the API
    (GET and check the field), not by the mutation merely returning 200.

FROZEN — NEVER EDIT:
- `package.json`, `package-lock.json`, `node_modules/`
- `Dockerfile` (production image build — see deployment)
- `next.config.js`, `tailwind.config.ts`, `tsconfig.json`
- `db/client.ts` (the better-sqlite3 connection)
- `scripts/**` (run/build/port plumbing)

## Field Provenance Rules (from the spec)

- `provenance: "confirmed"` — full treatment: DB column, API, visible in UI.
- `provenance: "data_only"` — DB column and migration, NO UI rendering.
- `provenance: "ui_only"` — DB column with the spec's default/derivation;
  render it; add a code comment `// ui_only: not present in export`.

## Excluded Features

For each entry in the spec's `excluded` array, add one line to
`RESURRECTION_NOTES.md` (create it at repo root): the feature name and
reason. Do not implement any of them in any form.

## Asking For Clarification

If the spec is genuinely ambiguous in a way that blocks you from proceeding
correctly (not a style preference — an actual fork in what to build), end
your turn with a structured response matching the configured output schema:
`{"status": "needs_clarification", "question": "..."}`. Ask ONE specific,
answerable question. Do not guess at product decisions the spec doesn't
resolve; do not stall on things you can reasonably infer. When you're truly
done, respond with `{"status": "done"}`.

## Workflow — Follow This Order Exactly

1. Read `spec/product-spec.json` fully before writing anything.
2. `db/schema.sql` → run `npm run db:init` → verify exit 0.
3. `db/migrate.ts` → run `npm run migrate` → verify exit 0 and logged row
   counts match migration_plan.row_count_expected. STOP AND FIX before
   proceeding if counts mismatch — a count mismatch is a transform bug, not
   a rounding detail.
4. API routes.
5. Views, written from scratch per view. Use labels.ts for all user-facing
   text.
6. `tests/smoke.test.ts` → run `npm run smoke`.
7. If any test fails: read the failure output, fix the MINIMAL thing, rerun.
   Repeat until green. Do not delete or weaken a failing test to pass —
   tests encode the spec's workflows; a deleted test is a lie. Before each
   rerun, stop any dev/test server you started for the previous attempt —
   do not leave it running and start another. This environment is reused
   across build attempts; leftover background servers from earlier
   iterations compound and can exhaust its memory, which has actually
   happened.
8. When green, write `RESURRECTION_NOTES.md` (excluded features + any
   open_questions from the spec, verbatim), make sure no background
   dev/test server you started is still running, and stop.

## Hard Prohibitions

- No new dependencies, no network calls at runtime, no external services.
- No authentication, sessions, or user accounts.
- No renaming spec fields. The spec's names and verbatim labels are
  contractual — they came from what the user actually saw on screen.
- No placeholder/lorem data. The ONLY data in the app is migrated data.
- No console.log left in app code (migrate.ts logging is the exception).
- No background dev/test servers left running when you finish or between
  test iterations — kill each one before starting the next.
- Do not modify this file.

## Error Handling Posture

Migration transforms must be defensive: a row that fails a transform is
logged with its source line number and skipped, never silently dropped, and
never allowed to crash the whole migration. Report skipped-row counts in the
final migration log.

## Style

Match the existing seed code style. TypeScript strict. Small components.
No cleverness — this code must be readable by the user who now owns it.
