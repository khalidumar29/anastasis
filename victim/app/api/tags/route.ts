import { NextResponse } from "next/server";
import db, { Tag } from "@/lib/db";

export const dynamic = "force-dynamic";

export function GET() {
  const tags = db.prepare("SELECT * FROM tags ORDER BY name").all() as Tag[];
  return NextResponse.json(tags);
}
