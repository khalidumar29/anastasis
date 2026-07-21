"use client";

import type { Task } from "@/lib/db";

const PRIORITY_STYLES: Record<Task["priority"], string> = {
  low: "bg-slate-100 text-slate-600",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-rose-100 text-rose-700",
};

export default function TaskCard({
  task,
  onClick,
}: {
  task: Task;
  onClick: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", task.id)}
      onClick={onClick}
      className="cursor-pointer rounded-md border border-slate-200 bg-white p-3 shadow-sm hover:border-indigo-300 hover:shadow"
    >
      <p className="text-sm font-medium text-slate-800">{task.title}</p>
      <div className="mt-2 flex items-center justify-between">
        <span
          className={`rounded px-1.5 py-0.5 text-xs font-medium capitalize ${PRIORITY_STYLES[task.priority]}`}
        >
          {task.priority}
        </span>
        {task.due_date && (
          <span className="text-xs text-slate-400">Due {task.due_date}</span>
        )}
      </div>
    </div>
  );
}
