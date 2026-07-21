import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Anastasis — bring your app back",
  description:
    "Resurrect a dead or unaffordable app from a screen recording and a data export.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
