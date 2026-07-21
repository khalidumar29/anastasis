# Anastasis — Your app died. Your data didn't.

*Anastasis is Greek for "resurrection."*

Give Anastasis a ~2-minute **screen recording** of an app you use and the
**data export ZIP** it lets you download. It rebuilds the app — only the
parts you were actually seen using — migrates your data in, verifies
everything with tests, and deploys it live on its own HTTPS subdomain.
Whether the app is shutting down or just charging too much, your workflow
becomes something you own.

**Live:** [https://anastasis.app](https://anastasis.app)
**A real resurrection produced by it:**
[https://run-1784658674974.anastasis.app](https://run-1784658674974.anastasis.app)
— a task board rebuilt from a screen recording + CSV export, with all 412
records migrated.

---

## ⭐ How GPT-5.6 and Codex are used

The entire pipeline runs on the GPT-5.6 family (`gpt-5.6-sol`), and none of
it is decoration — each capability does a distinct, load-bearing job:

| Stage | Model / tool | What it does | Code |
|---|---|---|---|
| **Watch** | GPT-5.6 **vision** | Studies frame batches extracted from the screen recording (ffmpeg → deduped keyframes) and writes exhaustive observation notes: every screen, verbatim button label, click, and visible field | [`orchestrator/lib/pipeline/watch.ts`](orchestrator/lib/pipeline/watch.ts) |
| **Understand** | GPT-5.6 + **structured outputs** | Turns the notes into a machine-checkable `AnastasisProductSpec` (Zod schema → `zodResponseFormat`): entities, fields, views, workflows — and explicitly *excludes* features the user never touched | [`orchestrator/lib/pipeline/understand.ts`](orchestrator/lib/pipeline/understand.ts), [`orchestrator/lib/spec/schema.ts`](orchestrator/lib/spec/schema.ts) |
| **Match** | GPT-5.6 + structured outputs | Cross-checks the draft spec against the export ZIP's real columns, sample rows, and row counts. Fields get provenance (`confirmed` / `data_only` / `ui_only`); conflicts become questions, never guesses | [`orchestrator/lib/pipeline/match.ts`](orchestrator/lib/pipeline/match.ts) |
| **Build** | **Codex** (`codex exec`, pinned to `gpt-5.6-sol`) | Writes the entire replacement app from scratch — SQLite schema, data migration, API routes, React/Tailwind UI, and its own smoke tests — governed by the [`Agents.md`](Agents.md) contract, iterating until its tests pass | [`orchestrator/lib/pipeline/codex-runner.ts`](orchestrator/lib/pipeline/codex-runner.ts), [`orchestrator/lib/pipeline/build.ts`](orchestrator/lib/pipeline/build.ts) |
| **Ask** | Codex **structured output schema** + `codex exec resume` | When the spec is genuinely ambiguous (e.g. the export says `low/medium/high` but the UI only ever showed `Medium/High`), Codex ends its turn with `{"status":"needs_clarification","question":...}`. The pipeline pauses, surfaces the question in the browser, and resumes the *same Codex session* with the user's typed answer | [`orchestrator/lib/pipeline/codex-schema.json`](orchestrator/lib/pipeline/codex-schema.json), [`orchestrator/app/api/resurrect/answer/route.ts`](orchestrator/app/api/resurrect/answer/route.ts) |

**Trust comes from verification, not vibes.** After Codex claims it's done,
the orchestrator independently re-runs everything and fails the build if any
gate breaks:

- **Dependency allowlist** — the generated `package.json` is diffed against
  the seed's; any added package fails the build
  ([`verify-deps.ts`](orchestrator/lib/pipeline/verify-deps.ts))
- **Migration fidelity** — `npm run migrate` must exit 0 with row counts
  matching the spec's `row_count_expected`
- **Smoke tests** — Codex's own generated per-workflow tests are re-run
  independently, with process-group timeouts so a hung app can't wedge a run
- **Styling gate** — a build whose `layout.tsx` skips the `globals.css`
  import (which would ship a fully-functional but completely unstyled app)
  is mechanically rejected

The dogfooding detail we're proud of: **the orchestrator itself is built and
deployed by the same Kaniko-in-Kubernetes pipeline that deploys the apps it
resurrects** — a Codex-built system whose product is Codex-generated
software.

---

## How it works (architecture)

```
browser (login → upload video + zip)
   │  SSE progress feed (survives disconnects; heartbeats vs. proxy timeouts)
   ▼
orchestrator (Next.js, k8s Deployment)
   frames     ffmpeg → ~10 deduped keyframes
   watch      GPT-5.6 vision → observation notes
   understand GPT-5.6 structured output → draft spec
   match      GPT-5.6 × export ZIP → final spec + migration plan
   build      Codex writes app → paused Q&A if ambiguous → verification gates
   deploy     Kaniko Job builds image → in-cluster registry
              → per-tenant Namespace/Deployment/Service/Ingress
   ▼
https://<run-id>.anastasis.app   (wildcard DNS + Cloudflare TLS)
```

Production runs on a **2-node k3s cluster** across two VPSes (ingress-nginx
on NodePorts behind the hosts' existing nginx, in-cluster registry, Kaniko
for daemonless image builds, persistent volumes for run artifacts *and*
Codex's session history — so a paused clarification survives pod restarts).

## Repo layout

- **`orchestrator/`** — the product. Landing page, login (seeded users, no
  self-serve registration), the gated `/app` uploader with per-user
  resurrection history, the five-stage pipeline
  (`orchestrator/lib/pipeline/`), SQLite persistence, and the Kubernetes
  deploy logic ([`deploy.ts`](orchestrator/lib/pipeline/deploy.ts)).
- **`template/`** — the minimal seed Codex starts from: Next.js + Tailwind +
  better-sqlite3 with pre-installed deps and a frozen production
  `Dockerfile`. No pre-built UI components — Codex writes every view from
  scratch, subject to the gates above. Rules live in
  [`Agents.md`](Agents.md).
- **`victim/`** — the small task-board app we built to play "the app that's
  shutting down" in the demo (412 tasks, 4 tags). Its export route produces
  the ZIP shape the pipeline consumes.
- **`fixtures/`** — a recording of someone using `victim/`
  (`recording.mov`) plus its matching export (`taskflow-export.zip`), so the
  pipeline can be exercised repeatably without re-recording.
- **`infra/`** — Terraform for the cluster-wide pieces (registry, Postgres,
  orchestrator Deployment/RBAC/Ingress, Cloudflare DNS) and
  [`runbook-phase1.md`](infra/runbook-phase1.md) documenting the real
  bootstrap, including every production lesson learned the hard way.

## Running locally

Prerequisites: Node 20+, `ffmpeg` on PATH, Codex CLI
(`npm i -g @openai/codex`, logged in), an OpenAI API key with GPT-5.6
access.

```bash
cd orchestrator && npm install && cp .env.example .env   # add OPENAI_API_KEY
cd ../template && npm install
cd ../orchestrator && npm run dev                        # http://localhost:3000
```

Log in with the seeded demo user (`demo@anastasis.app` — password defaults
in `lib/db/client.ts`, override with `ANASTASIS_DEMO_PASSWORD`), drop in
`fixtures/recording.mov` + `fixtures/taskflow-export.zip`, and click
**Resurrect my app**. Progress streams live; if Codex hits an ambiguity, a
question box appears and the build resumes with your answer. Locally the
finished app is served on a dev port; in production
(`ANASTASIS_DEPLOY_TARGET=k8s`) it's containerized and deployed to its own
subdomain automatically.

### CLI harnesses (no browser)

```bash
cd orchestrator
# full pipeline against the fixtures
npm run pipeline -- ../fixtures/recording.mov ../fixtures/taskflow-export.zip my-run
# just the build stage (Codex + verification) from a saved spec
npm run build:app -- my-run ../fixtures/taskflow-export.zip
```

A full run writes everything to `orchestrator/runs/<run-id>/` (frames,
observation notes, draft/final spec, generated `app/`), gitignored locally
and on a persistent volume in production.

### Verifying a resurrected app manually

Inside any generated `app/` directory:

```bash
npm run db:init   # create the schema
npm run migrate   # load import/ data — must exit 0 with matching row counts
npm run smoke     # boots the app and runs its generated tests against it
npm run dev       # open it in the browser
```

## What it deliberately does NOT do

- No cloning of any commercial product's branding, assets, or code — it
  rebuilds *functionality you personally used, around your own data*
- No feature you weren't seen using — exclusions are logged per-app in
  `RESURRECTION_NOTES.md`
- No placeholder data — the only data in a resurrected app is migrated data
- No unattended guessing — genuine ambiguity pauses the build and asks you
