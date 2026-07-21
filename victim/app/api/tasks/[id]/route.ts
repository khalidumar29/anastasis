import { NextRequest, NextResponse } from "next/server";
import db, { Task } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const existing = db
    .prepare("SELECT * FROM tasks WHERE id = ?")
    .get(params.id) as Task | undefined;
  if (!existing) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  const body = await req.json();
  const updated: Task = {
    ...existing,
    title: body.title !== undefined ? String(body.title).trim() : existing.title,
    status: body.status ?? existing.status,
    priority: body.priority ?? existing.priority,
    due_date: body.due_date !== undefined ? body.due_date || null : existing.due_date,
    tag_id: body.tag_id !== undefined ? body.tag_id || null : existing.tag_id,
  };
  db.prepare(
    "UPDATE tasks SET title = ?, status = ?, priority = ?, due_date = ?, tag_id = ? WHERE id = ?"
  ).run(
    updated.title,
    updated.status,
    updated.priority,
    updated.due_date,
    updated.tag_id,
    params.id
  );
  return NextResponse.json(updated);
}

export function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const result = db.prepare("DELETE FROM tasks WHERE id = ?").run(params.id);
  if (result.changes === 0) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
