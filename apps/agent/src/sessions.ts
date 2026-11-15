/**
 * Chat session → Zendesk ticket, so every message in one chat lands on the same ticket. Kept in
 * Postgres (the agent's own table, not the demo API's) so it survives agent restarts.
 *
 * The ticket's created_at is stored too: `bun run reset` restarts ticket ids at #2041, and a chat
 * left open across a reset must not attach to someone else's new #2041.
 */
import { SQL } from "bun";

export interface ChatSession {
  ticketId: number;
  ticketCreatedAt: string;
}

export interface SessionStore {
  get(sessionId: string): Promise<ChatSession | undefined>;
  set(sessionId: string, session: ChatSession): Promise<void>;
}

export function memorySessions(): SessionStore {
  const map = new Map<string, ChatSession>();
  return {
    get: async (id) => map.get(id),
    set: async (id, session) => void map.set(id, session),
  };
}

export async function postgresSessions(url: string): Promise<SessionStore & { close(): Promise<void> }> {
  const sql = new SQL(url, { max: 3, idleTimeout: 30, connectionTimeout: 10 });
  await sql`
    create table if not exists agent_chat_sessions (
      session_id text primary key,
      ticket_id integer not null,
      ticket_created_at timestamptz not null,
      updated_at timestamptz not null default now()
    )`;
  return {
    async get(id) {
      const [row] = await sql<{ ticket_id: number; ticket_created_at: Date }[]>`
        select ticket_id, ticket_created_at from agent_chat_sessions where session_id = ${id}`;
      return row && { ticketId: row.ticket_id, ticketCreatedAt: row.ticket_created_at.toISOString() };
    },
    async set(id, { ticketId, ticketCreatedAt }) {
      await sql`
        insert into agent_chat_sessions (session_id, ticket_id, ticket_created_at)
        values (${id}, ${ticketId}, ${ticketCreatedAt})
        on conflict (session_id) do update set ticket_id = excluded.ticket_id, ticket_created_at = excluded.ticket_created_at, updated_at = now()`;
    },
    close: () => sql.close(),
  };
}
