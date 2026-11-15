import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import type { Db } from "./client.ts";

// fileURLToPath, not URL.pathname: pathname gives "/C:/..." on Windows, which fs can't open.
const MIGRATIONS = fileURLToPath(new URL("../drizzle", import.meta.url));

/** Applies any SQL migrations in packages/db/drizzle that haven't run yet. Safe to call on every start. */
export async function runMigrations(db: Db) {
  await migrate(db, { migrationsFolder: MIGRATIONS });
}
