/** The API's connection to Postgres (DATABASE_URL). Tables, seed data and migrations live in packages/db. */
import { createDb, ensureSeeded, runMigrations } from "@ph/db";

export const db = createDb();

/** Applies pending migrations and seeds an empty database. Run once at startup. */
export async function prepare(): Promise<"seeded" | "ready"> {
  await runMigrations(db);
  return (await ensureSeeded(db)) ? "seeded" : "ready";
}
