/** `bun run db:migrate` (migrate, then seed if empty) and `bun run reset` (wipe and re-seed the demo data). */
import { createDb } from "./client.ts";
import { runMigrations } from "./migrate.ts";
import { ensureSeeded, resetDemoData } from "./seed.ts";

const command = process.argv[2];
const db = createDb();
try {
  await runMigrations(db);
  if (command === "reset") {
    await resetDemoData(db);
    console.log("Demo data reset");
  } else if (command === "migrate") {
    console.log((await ensureSeeded(db)) ? "Migrated and seeded the demo data" : "Migrated (demo data already there)");
  } else {
    throw new Error(`Unknown command "${command}". Use migrate or reset.`);
  }
} finally {
  await db.$client.close();
}
