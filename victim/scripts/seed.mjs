import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "taskflow.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'done')),
    priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
    due_date TEXT,
    created_at TEXT NOT NULL,
    tag_id TEXT REFERENCES tags(id)
  );
`);

db.exec("DELETE FROM tasks; DELETE FROM tags;");

const tags = [
  { id: randomUUID(), name: "Work" },
  { id: randomUUID(), name: "Personal" },
  { id: randomUUID(), name: "Errands" },
  { id: randomUUID(), name: "Learning" },
];

const insertTag = db.prepare("INSERT INTO tags (id, name) VALUES (?, ?)");
for (const tag of tags) insertTag.run(tag.id, tag.name);

const verbs = [
  "Review", "Update", "Draft", "Fix", "Refactor", "Schedule", "Prepare",
  "Send", "Research", "Organize", "Plan", "Write", "Test", "Deploy",
  "Design", "Audit", "Archive", "Merge", "Document", "Investigate",
];
const objects = [
  "quarterly report", "landing page copy", "invoice batch", "onboarding flow",
  "team standup notes", "client proposal", "budget spreadsheet", "API docs",
  "marketing email", "database backup", "user feedback survey", "sprint board",
  "release notes", "expense claims", "meeting agenda", "product roadmap",
  "support tickets", "newsletter draft", "performance review", "signup form",
  "billing settings", "error logs", "photo library", "reading list",
  "grocery order", "travel itinerary", "insurance renewal", "tax documents",
];
const statuses = ["todo", "in_progress", "done"];
const priorities = ["low", "medium", "high"];

// Deterministic pseudo-random so reseeding produces the same dataset.
let seedState = 42;
function rand() {
  seedState = (seedState * 1103515245 + 12345) % 2147483648;
  return seedState / 2147483648;
}
function pick(arr) {
  return arr[Math.floor(rand() * arr.length)];
}

function isoDate(daysFromNow) {
  const d = new Date("2026-07-18T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

const TASK_COUNT = 412;
const insertTask = db.prepare(
  "INSERT INTO tasks (id, title, status, priority, due_date, created_at, tag_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
);

const insertAll = db.transaction(() => {
  for (let i = 0; i < TASK_COUNT; i++) {
    const title = `${pick(verbs)} ${pick(objects)}`;
    const status = pick(statuses);
    const priority = pick(priorities);
    const dueDate = rand() < 0.8 ? isoDate(Math.floor(rand() * 60) - 20) : null;
    const createdAt = new Date(
      Date.UTC(2026, 0, 1) + Math.floor(rand() * 190) * 86400000
    ).toISOString();
    const tagId = rand() < 0.6 ? pick(tags).id : null;
    insertTask.run(randomUUID(), title, status, priority, dueDate, createdAt, tagId);
  }
});
insertAll();

const taskCount = db.prepare("SELECT COUNT(*) AS c FROM tasks").get().c;
const tagCount = db.prepare("SELECT COUNT(*) AS c FROM tags").get().c;
console.log(`Seeded ${taskCount} tasks, ${tagCount} tags.`);
