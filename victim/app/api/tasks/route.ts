import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import db, { Task } from "@/lib/db";

export const dynamic = "force-dynamic";

export function GET() {
  const tasks = db
    .prepare("SELECT * FROM tasks ORDER BY created_at DESC")
    .all() as Task[];
  return NextResponse.json(tasks);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const task: Task = {
    id: randomUUID(),
    title: String(body.title ?? "").trim(),
    status: body.status ?? "todo",
    priority: body.priority ?? "medium",
    due_date: body.due_date || null,
    created_at: new Date().toISOString(),
    tag_id: body.tag_id || null,
  };
  if (!task.title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }
  db.prepare(
    "INSERT INTO tasks (id, title, status, priority, due_date, created_at, tag_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(
    task.id,
    task.title,
    task.status,
    task.priority,
    task.due_date,
    task.created_at,
    task.tag_id
  );
  return NextResponse.json(task, { status: 201 });
}
