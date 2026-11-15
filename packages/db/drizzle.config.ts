import { defineConfig } from "drizzle-kit";

// `bun run db:generate` writes a new SQL migration to ./drizzle after you change src/schema.ts.
// The API applies pending migrations on startup (and `bun run db:migrate` does it by hand).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
