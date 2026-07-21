import Link from "next/link";

const STEPS = [
  {
    n: "01",
    title: "Watch",
    text: "AI studies snapshots of your screen recording — every screen, button, and click you actually made.",
  },
  {
    n: "02",
    title: "Understand",
    text: "It works out what the app fundamentally is: the data, the views, the workflows you rely on.",
  },
  {
    n: "03",
    title: "Match",
    text: "Your export ZIP is cross-checked against what it saw on screen. Nothing invented, nothing lost.",
  },
  {
    n: "04",
    title: "Build",
    text: "Codex writes a brand-new app, migrates your data in, and tests itself until everything passes.",
  },
  {
    n: "05",
    title: "Deliver",
    text: "Your app goes live on its own subdomain — yours, running, with your data already inside.",
  },
];

const FEATURES = [
  {
    title: "Only what you used",
    text: "Features you never touched in the recording are left out on purpose. You get your 20%, not their bloat.",
  },
  {
    title: "Your data, migrated",
    text: "Every record from your export lands in the new app — counts verified, transforms tested, nothing dropped silently.",
  },
  {
    title: "It asks when unsure",
    text: "If your data conflicts with what it saw on screen, the AI pauses and asks you — instead of guessing wrong.",
  },
  {
    title: "Live on a real URL",
    text: "Each resurrection deploys to its own subdomain over HTTPS. Open it, use it, keep working.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="text-lg font-semibold tracking-tight">
          Anastasis<span className="text-indigo-400">.</span>
        </span>
        <nav className="flex items-center gap-6 text-sm">
          <a href="#how" className="text-slate-400 transition-colors hover:text-slate-100">
            How it works
          </a>
          <Link
            href="/login"
            className="rounded-lg bg-indigo-500 px-4 py-2 font-semibold text-white transition-colors hover:bg-indigo-400"
          >
            Log in
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-6 pb-20 pt-16 text-center sm:pt-24">
        <p className="mx-auto mb-6 inline-block rounded-full border border-indigo-500/30 bg-indigo-500/10 px-4 py-1.5 text-xs font-medium text-indigo-300">
          Powered by GPT-5.6 vision + Codex
        </p>
        <h1 className="mx-auto max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
          Your app died.
          <br />
          <span className="bg-gradient-to-r from-indigo-400 to-sky-400 bg-clip-text text-transparent">
            Your data didn&apos;t.
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-slate-400">
          Show Anastasis a 2-minute screen recording and your data export. It rebuilds the app you
          actually used — data included — and puts it live on a URL you own.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <Link
            href="/app"
            className="rounded-lg bg-indigo-500 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-400"
          >
            Resurrect your app →
          </Link>
          <a
            href="#how"
            className="rounded-lg border border-slate-700 px-6 py-3 text-sm font-semibold text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100"
          >
            See how it works
          </a>
        </div>
      </section>

      <section id="how" className="border-t border-slate-900 bg-slate-950/60">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">
            One recording. One ZIP. One living app.
          </h2>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((s) => (
              <div
                key={s.n}
                className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 transition-colors hover:border-indigo-500/40"
              >
                <span className="text-xs font-bold text-indigo-400">{s.n}</span>
                <h3 className="mt-2 font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-slate-900">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid gap-4 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
                <h3 className="font-semibold text-indigo-300">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{f.text}</p>
              </div>
            ))}
          </div>
          <div className="mt-16 rounded-2xl border border-indigo-500/30 bg-gradient-to-br from-indigo-500/10 to-sky-500/5 p-10 text-center">
            <h2 className="text-2xl font-semibold tracking-tight">
              Stop renting your own workflow.
            </h2>
            <p className="mx-auto mt-3 max-w-md text-slate-400">
              Whether it&apos;s shutting down or just costing too much — bring it back as something
              you own.
            </p>
            <Link
              href="/app"
              className="mt-8 inline-block rounded-lg bg-indigo-500 px-8 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-400"
            >
              Start a resurrection
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-8 text-xs text-slate-500">
          <span>Anastasis — bring your app back.</span>
          <span>Built with GPT-5.6 &amp; Codex</span>
        </div>
      </footer>
    </div>
  );
}
