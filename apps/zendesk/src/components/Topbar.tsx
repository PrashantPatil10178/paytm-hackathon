import { OWNER } from "@ph/shared";
import { Search } from "lucide-react";
import { navigate } from "@ph/shared/react";
import { useState } from "react";
import { Avatar } from "./ui.tsx";

export const ME = OWNER.name;

export function Topbar() {
  const [q, setQ] = useState("");
  return (
    <header className="flex h-14 flex-none items-center justify-between gap-4 border-b border-line bg-paper px-4 md:px-6">
      <form
        className="flex h-9 w-full max-w-[360px] items-center gap-2 rounded border border-line px-3 text-ink-3 focus-within:border-link focus-within:ring-3 focus-within:ring-link/20"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const id = q.trim().replace(/^#/, "");
          if (/^\d+$/.test(id)) navigate(`/tickets/${id}`);
          else navigate(`/tickets?view=all_unsolved&q=${encodeURIComponent(q.trim())}`);
        }}
      >
        <Search size={16} aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search ticket # or customer name"
          aria-label="Search ticket number or customer name"
          className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-3"
        />
      </form>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Avatar name={ME} tone="agent" />
          <div className="hidden leading-tight sm:grid">
            <span className="font-semibold whitespace-nowrap">{ME}</span>
            <span className="flex items-center gap-1 text-xs text-ink-3">
              <span className="size-2 rounded-full bg-online" aria-hidden /> Online
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
