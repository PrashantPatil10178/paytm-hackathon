import { migrate } from "drizzle-orm/bun-sql/migrator";
import type { Db } from "./client.ts";

const MIGRATIONS = new URL("../drizzle", import.meta.url).pathname;

/** Applies any SQL migrations in packages/db/drizzle that haven't run yet. Safe to call on every start. */
export async function runMigrations(db: Db) {
  await migrate(db, { migrationsFolder: MIGRATIONS });
}
