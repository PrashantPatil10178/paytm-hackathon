import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import * as schema from "./schema.ts";

/** Connects to DATABASE_URL (repo-root .env) with Bun's built-in Postgres driver. */
export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is not set. Add it to the repo-root .env (see .env.example).");
  const client = new SQL(url, { max: 10, idleTimeout: 30, connectionTimeout: 10 });
  return drizzle({ client, schema });
}

export type Db = ReturnType<typeof createDb>;
/** A database or an open transaction: anything you can run queries on. */
export type Tx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];
