import db, { Tag } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function TagsPage() {
  const tags = db.prepare("SELECT * FROM tags ORDER BY name").all() as Tag[];
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Tags</h1>
      <ul className="max-w-md divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {tags.map((tag) => (
          <li key={tag.id} className="px-4 py-3 text-sm text-slate-700">
            {tag.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
