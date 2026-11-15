/** The API's connection to Postgres (DATABASE_URL). Tables, seed data and migrations live in packages/db. */
import { createDb, ensurePolicies, ensureResolveAIConfig, ensureSeeded, runMigrations } from "@ph/db";

export const db = createDb();

/** Applies pending migrations and seeds an empty database. Run once at startup. */
export async function prepare(): Promise<"seeded" | "ready"> {
  await runMigrations(db);
  const seeded = await ensureSeeded(db);
  await ensureResolveAIConfig(db, `http://localhost:${Number(process.env.PORT ?? 4000)}`);
  // Business policies (configuration): adds missing ones by code, never overwrites edits.
  await ensurePolicies(db);
  return seeded ? "seeded" : "ready";
}
