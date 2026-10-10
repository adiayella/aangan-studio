import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { env } from "../config.js";

const dir = join(import.meta.dirname, "migrations");
const client = new pg.Client({ connectionString: env("DATABASE_URL") });
await client.connect();
try {
  await client.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const done = new Set((await client.query("select name from schema_migrations")).rows.map((r) => r.name));
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(f)) { console.log(`skip  ${f}`); continue; }
    await client.query("begin");
    try {
      await client.query(readFileSync(join(dir, f), "utf8"));
      await client.query("insert into schema_migrations(name) values ($1)", [f]);
      await client.query("commit");
      console.log(`apply ${f}`);
    } catch (e) {
      await client.query("rollback");
      throw e;
    }
  }
  const t = await client.query("select table_name from information_schema.tables where table_schema='public' order by 1");
  console.log("tables:", t.rows.map((r) => r.table_name).join(", "));
} finally {
  await client.end();
}
