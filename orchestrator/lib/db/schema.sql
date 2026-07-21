-- Login-only by design: no registration flow exists; users are seeded
-- (see client.ts). password_hash is scrypt salt:hash (lib/auth.ts).
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  status TEXT NOT NULL CHECK (
    status IN ('running', 'awaiting_input', 'building', 'ready', 'failed')
  ),
  app_url TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pending_questions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  session_id TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  answered_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_pending_questions_run_id ON pending_questions (run_id);

-- Phase 5 stub — no verification flow implemented yet (blocked on domain
-- purchase, see infra/runbook-phase1.md step 5). Table exists so the shape
-- is settled; addCustomDomain()/verifyCustomDomain() helpers come with the
-- actual DNS TXT challenge flow.
CREATE TABLE IF NOT EXISTS custom_domains (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  domain TEXT NOT NULL UNIQUE,
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (
    verification_status IN ('pending', 'verified', 'failed')
  ),
  verification_token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  verified_at TEXT
);
