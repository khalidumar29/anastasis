// FROZEN — do not edit. Applies db/schema.sql to a fresh data/app.db.
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const root = process.cwd();
const dataDir = path.join(root, "data");
fs.mkdirSync(dataDir, { recursive: true });

const schema = fs.readFileSync(path.join(root, "db", "schema.sql"), "utf8");
const db = new Database(path.join(dataDir, "app.db"));
db.pragma("journal_mode = WAL");
db.exec(schema);
console.log("Schema applied to data/app.db");
