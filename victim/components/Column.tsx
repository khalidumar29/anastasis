"use client";

import { useState } from "react";
import type { Task } from "@/lib/db";
import TaskCard from "./TaskCard";

export default function Column({
  status,
  label,
  tasks,
  onDropTask,
  onEditTask,
}: {
  status: Task["status"];
  label: string;
  tasks: Task[];
  onDropTask: (taskId: string, status: Task["status"]) => void;
  onEditTask: (task: Task) => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const taskId = e.dataTransfer.getData("text/plain");
        if (taskId) onDropTask(taskId, status);
      }}
      className={`flex min-h-[70vh] flex-col rounded-lg border p-3 transition-colors ${
        dragOver
          ? "border-indigo-400 bg-indigo-50"
          : "border-slate-200 bg-white"
      }`}
    >
      <div className="mb-3 flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </h2>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
          {tasks.length}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} onClick={() => onEditTask(task)} />
        ))}
      </div>
    </div>
  );
}
