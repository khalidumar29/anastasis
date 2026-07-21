import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Taskflow",
  description: "A simple task board",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-100 text-slate-900 antialiased">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
            <div className="flex items-center gap-8">
              <span className="text-lg font-bold tracking-tight text-indigo-600">
                Taskflow
              </span>
              <nav className="flex items-center gap-5 text-sm font-medium text-slate-600">
                <Link href="/" className="hover:text-slate-900">
                  Board
                </Link>
                <Link href="/tags" className="hover:text-slate-900">
                  Tags
                </Link>
              </nav>
            </div>
            <a
              href="/api/export"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Export data
            </a>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
