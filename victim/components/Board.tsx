"use client";

import { useCallback, useEffect, useState } from "react";
import type { Task } from "@/lib/db";
import Column from "./Column";
import TaskDialog from "./TaskDialog";

const COLUMNS: { status: Task["status"]; label: string }[] = [
  { status: "todo", label: "To Do" },
  { status: "in_progress", label: "In Progress" },
  { status: "done", label: "Done" },
];

export default function Board() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/tasks");
    setTasks(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDrop = async (taskId: string, status: Task["status"]) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status } : t))
    );
    await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  };

  const handleSave = async (data: Partial<Task>) => {
    if (editingTask) {
      await fetch(`/api/tasks/${editingTask.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    } else {
      await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    }
    setDialogOpen(false);
    setEditingTask(null);
    load();
  };

  const handleDelete = async (taskId: string) => {
    await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
    setDialogOpen(false);
    setEditingTask(null);
    load();
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Board</h1>
        <button
          onClick={() => {
            setEditingTask(null);
            setDialogOpen(true);
          }}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          New task
        </button>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {COLUMNS.map((col) => (
          <Column
            key={col.status}
            status={col.status}
            label={col.label}
            tasks={tasks.filter((t) => t.status === col.status)}
            onDropTask={handleDrop}
            onEditTask={(task) => {
              setEditingTask(task);
              setDialogOpen(true);
            }}
          />
        ))}
      </div>
      {dialogOpen && (
        <TaskDialog
          task={editingTask}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => {
            setDialogOpen(false);
            setEditingTask(null);
          }}
        />
      )}
    </div>
  );
}
