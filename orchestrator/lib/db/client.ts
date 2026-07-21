import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { hashPassword } from "../auth";

// Local-dev stand-in for the in-cluster Postgres the real deployment uses —
// same schema either way. See infra/ for the production persistence layer.
const DATA_DIR = path.join(process.cwd(), ".data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "anastasis.db"));
db.pragma("journal_mode = WAL");
db.exec(fs.readFileSync(path.join(process.cwd(), "lib", "db", "schema.sql"), "utf8"));

// schema.sql only creates tables that don't exist — an already-deployed db
// has a runs table without user_id, so migrate it in place.
try {
  db.exec("ALTER TABLE runs ADD COLUMN user_id TEXT REFERENCES users(id)");
} catch {
  // column already exists
}

// No registration by design — seed the demo user on first boot. Password
// comes from env when provided; the fallback is for local dev only and is
// what the deployed Secret should override. OR IGNORE because this module
// loads in parallel Next.js build workers — a check-then-insert raced
// itself into a UNIQUE violation during `next build`.
db.prepare(
  "INSERT OR IGNORE INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)"
).run(
  crypto.randomUUID(),
  "demo@anastasis.app",
  "Demo User",
  hashPassword(process.env.ANASTASIS_DEMO_PASSWORD ?? "resurrect-2026")
);

export type RunStatus = "running" | "awaiting_input" | "building" | "ready" | "failed";

export type Run = {
  id: string;
  user_id: string | null;
  status: RunStatus;
  app_url: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type User = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  created_at: string;
};

export type PendingQuestion = {
  id: string;
  run_id: string;
  session_id: string;
  question: string;
  answer: string | null;
  created_at: string;
  answered_at: string | null;
};

export function createRun(id: string, userId?: string | null): void {
  db.prepare("INSERT INTO runs (id, user_id, status) VALUES (?, ?, 'running')").run(
    id,
    userId ?? null
  );
}

export function getUserByEmail(email: string): User | undefined {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email) as User | undefined;
}

export function getUserById(id: string): User | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as User | undefined;
}

export function listRunsByUser(userId: string): Run[] {
  return db
    .prepare("SELECT * FROM runs WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as Run[];
}

export function setRunStatus(
  id: string,
  status: RunStatus,
  extra: { appUrl?: string; error?: string } = {}
): void {
  db.prepare(
    `UPDATE runs SET status = ?, app_url = COALESCE(?, app_url), error = COALESCE(?, error), updated_at = datetime('now') WHERE id = ?`
  ).run(status, extra.appUrl ?? null, extra.error ?? null, id);
}

export function getRun(id: string): Run | undefined {
  return db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as Run | undefined;
}

export function addPendingQuestion(runId: string, sessionId: string, question: string): string {
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO pending_questions (id, run_id, session_id, question) VALUES (?, ?, ?, ?)"
  ).run(id, runId, sessionId, question);
  return id;
}

/** The most recent unanswered question for a run, if any. */
export function getOpenQuestion(runId: string): PendingQuestion | undefined {
  return db
    .prepare(
      "SELECT * FROM pending_questions WHERE run_id = ? AND answer IS NULL ORDER BY created_at DESC LIMIT 1"
    )
    .get(runId) as PendingQuestion | undefined;
}

export function answerQuestion(questionId: string, answer: string): void {
  db.prepare(
    "UPDATE pending_questions SET answer = ?, answered_at = datetime('now') WHERE id = ?"
  ).run(answer, questionId);
}
