import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { getUserById, listRunsByUser, type Run } from "@/lib/db/client";
import Uploader from "./uploader";
import LogoutButton from "./logout-button";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<Run["status"], string> = {
  ready: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  running: "bg-sky-500/10 text-sky-400 border-sky-500/30",
  building: "bg-sky-500/10 text-sky-400 border-sky-500/30",
  awaiting_input: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  failed: "bg-rose-500/10 text-rose-400 border-rose-500/30",
};

export default function AppPage() {
  const userId = verifySessionToken(cookies().get(SESSION_COOKIE_NAME)?.value);
  if (!userId) redirect("/login");
  const user = getUserById(userId);
  if (!user) redirect("/login");

  const runs = listRunsByUser(userId);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="mx-auto flex max-w-2xl items-center justify-between px-6 py-5">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Anastasis<span className="text-indigo-400">.</span>
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-slate-400">{user.name}</span>
          <LogoutButton />
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 pb-16 pt-8">
        <h1 className="text-2xl font-semibold tracking-tight">Resurrect an app</h1>
        <p className="mt-1 text-sm text-slate-400">
          Drop in a screen recording and your data export — watch it come back.
        </p>

        <div className="mt-8">
          <Uploader />
        </div>

        <h2 className="mt-14 text-lg font-semibold tracking-tight">Your resurrections</h2>
        {runs.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            Nothing yet — your resurrected apps will appear here.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {runs.map((run) => (
              <li
                key={run.id}
                className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/50 px-4 py-3"
              >
                <div>
                  <p className="font-mono text-xs text-slate-500">{run.id}</p>
                  <p className="mt-1 text-xs text-slate-400">{run.created_at} UTC</p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[run.status]}`}
                  >
                    {run.status.replace("_", " ")}
                  </span>
                  {run.app_url && (
                    <a
                      href={run.app_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-semibold text-indigo-400 transition-colors hover:text-indigo-300"
                    >
                      Open →
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
