import type { TicketView } from "@ph/shared";
import { linkProps } from "@ph/shared/react";
import { VIEWS } from "../views.ts";

export function Sidebar({ active, counts }: { active: TicketView | null; counts?: Record<TicketView, number> }) {
  return (
    <aside
      className="flex flex-col gap-2 bg-kale px-4 py-3 text-white md:sticky md:top-0 md:h-dvh md:gap-6 md:px-3 md:py-4 [&_:focus-visible]:outline-white"
      aria-label="Views"
    >
      <a className="flex items-baseline gap-2 px-2 py-1 text-white no-underline" {...linkProps("/tickets?view=all_unsolved")}>
        <span className="text-[22px] font-bold tracking-tight">zendesk</span>
        <span className="text-xs text-kale-muted">(Demo)</span>
      </a>
      <nav>
        <h2 className="hidden px-2 pb-2 text-xs font-semibold text-kale-muted md:block">Views</h2>
        <ul className="flex gap-1 overflow-x-auto md:grid md:gap-0.5">
          {VIEWS.map((v) => {
            const on = active === v.id;
            return (
              <li key={v.id}>
                <a
                  {...linkProps(`/tickets?view=${v.id}`)}
                  aria-current={on ? "page" : undefined}
                  className={`flex items-center justify-between gap-2 rounded p-2 whitespace-nowrap text-white no-underline hover:bg-kale-2 ${on ? "bg-white/15 font-semibold" : ""}`}
                >
                  <span>{v.label}</span>
                  <span className={`tabular-nums ${on ? "text-white" : "text-kale-muted"}`}>{counts ? counts[v.id] : "–"}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
      <p className="mt-auto hidden px-2 text-xs text-kale-muted md:block">Support · ShopKart</p>
    </aside>
  );
}
