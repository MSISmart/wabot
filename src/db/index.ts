import { drizzle as drizzlePg, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { migrations } from "./migrations";

export type DB = PostgresJsDatabase<typeof schema>;
type Handle = { db: DB; exec: (sql: string) => Promise<void>; query: (sql: string) => Promise<Record<string, unknown>[]> };

const g = globalThis as unknown as { __wabot_db?: Promise<Handle> };

async function open(): Promise<Handle> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const postgres = (await import("postgres")).default;
    const sql = postgres(url, { max: 5, prepare: false, onnotice: () => {} });
    return {
      db: drizzlePg(sql, { schema }),
      exec: async (q) => { await sql.unsafe(q); },
      query: async (q) => (await sql.unsafe(q)) as unknown as Record<string, unknown>[],
    };
  }
  // No DATABASE_URL: embedded Postgres (PGlite) stored on disk. Zero setup for local use.
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const dir = process.env.PGLITE_DIR ?? ".data/pglite";
  if (dir !== "memory") (await import("node:fs")).mkdirSync(dir, { recursive: true });
  const client = dir === "memory" ? new PGlite() : new PGlite(dir);
  return {
    db: drizzle(client, { schema }) as unknown as DB,
    exec: async (q) => { await client.exec(q); },
    query: async (q) => (await client.query(q)).rows as Record<string, unknown>[],
  };
}

async function migrate(h: Handle) {
  await h.exec(`CREATE TABLE IF NOT EXISTS app_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await h.query(`SELECT name FROM app_migrations`)).map((r) => r.name as string));
  for (const m of migrations) {
    if (done.has(m.name)) continue;
    await h.exec(`BEGIN; ${m.sql}; INSERT INTO app_migrations (name) VALUES ('${m.name}'); COMMIT;`);
  }
}

export function getDb(): Promise<DB> {
  if (!g.__wabot_db) {
    g.__wabot_db = open().then(async (h) => { await migrate(h); return h; });
    g.__wabot_db.catch(() => { g.__wabot_db = undefined; });
  }
  return g.__wabot_db.then((h) => h.db);
}

export { schema };
