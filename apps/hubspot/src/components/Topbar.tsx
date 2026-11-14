import { linkProps } from "@ph/shared/react";
import { Avatar } from "./ui.tsx";

export const ME = "Rahul – Sales";

const tabCls = (active: boolean) =>
  `relative flex h-14 items-center px-4 text-[15px] text-white no-underline transition-colors hover:bg-navy-2 ${
    active ? "font-semibold after:absolute after:inset-x-3 after:bottom-0 after:h-[3px] after:rounded-t after:bg-orange" : "text-white/80"
  }`;

export function Topbar({ tab }: { tab: "deals" | "contacts" }) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-6 bg-navy px-4 text-white sm:px-6">
      <a className="flex items-center gap-2 text-white no-underline" {...linkProps("/deals")}>
        <span className="grid size-7 place-items-center rounded-full bg-orange" aria-hidden>
          <span className="size-2.5 rounded-full bg-navy" />
        </span>
        <span className="hidden text-base font-semibold tracking-tight sm:inline">HubSpot CRM</span>
        <span className="hidden text-xs text-white/70 sm:inline">(Demo)</span>
      </a>
      <nav className="flex h-full" aria-label="CRM">
        <a {...linkProps("/deals")} className={tabCls(tab === "deals")} aria-current={tab === "deals" ? "page" : undefined}>
          Deals
        </a>
        <a {...linkProps("/contacts")} className={tabCls(tab === "contacts")} aria-current={tab === "contacts" ? "page" : undefined}>
          Contacts
        </a>
      </nav>
      <div className="ml-auto flex items-center gap-1">
        <span className="flex items-center gap-2">
          <Avatar name={ME} />
          <span className="hidden whitespace-nowrap md:inline">{ME}</span>
        </span>
      </div>
    </header>
  );
}
