import { initials } from "@ph/shared";
import { linkProps } from "@ph/shared/react";
import { ChevronDown, ShoppingBag } from "lucide-react";
import { useCustomer } from "../store.tsx";
import { Logo } from "./Logo.tsx";

const NAV = [
  { to: "/", label: "Home" },
  { to: "/orders", label: "My Orders" },
  { to: "/help", label: "Help" },
  { to: "/business", label: "Business Enquiry" },
];

export function Header({ path }: { path: string }) {
  const { customers, customer, setCustomerId, cartCount } = useCustomer();

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur-md">
      <div className="wrap flex h-16 items-center gap-6">
        <a {...linkProps("/")} className="flex-none rounded-lg" aria-label="ShopKart home">
          <Logo />
        </a>

        <nav aria-label="Main" className="hidden h-full md:flex">
          {NAV.map((n) => (
            <NavLink key={n.to} {...n} active={path === n.to} />
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <label className="group relative flex items-center gap-2 rounded-full border border-line py-1 pr-8 pl-1 transition-colors focus-within:border-jamun hover:border-ink-3">
            <span className="grid size-8 flex-none place-items-center rounded-full bg-jamun-wash text-xs font-bold text-jamun" aria-hidden>
              {customer ? initials(customer.name) : "··"}
            </span>
            <span className="hidden flex-col leading-tight sm:flex">
              <span className="text-[11px] text-ink-3">Logged in as</span>
              <span className="text-sm font-semibold">{customer?.name ?? "Loading…"}</span>
            </span>
            <select
              aria-label="Logged in as"
              className="absolute inset-0 cursor-pointer appearance-none rounded-full opacity-0"
              value={customer?.id ?? ""}
              onChange={(e) => setCustomerId(Number(e.target.value))}
            >
              {customers?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.city}
                </option>
              ))}
            </select>
            <ChevronDown size={16} className="pointer-events-none absolute right-2.5 text-ink-3" aria-hidden />
          </label>

          <span className="relative grid size-10 place-items-center rounded-full text-ink" aria-label={`${cartCount} items in your cart`} role="img">
            <ShoppingBag size={20} aria-hidden />
            {cartCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 grid h-5 min-w-5 animate-pop-in place-items-center rounded-full bg-marigold px-1 text-[11px] font-bold text-marigold-ink tabular-nums">
                {cartCount}
              </span>
            )}
          </span>
        </div>
      </div>

      <nav aria-label="Main" className="wrap flex h-11 gap-1 overflow-x-auto border-t border-line md:hidden">
        {NAV.map((n) => (
          <NavLink key={n.to} {...n} active={path === n.to} />
        ))}
      </nav>
    </header>
  );
}

function NavLink({ to, label, active }: { to: string; label: string; active: boolean }) {
  return (
    <a
      {...linkProps(to)}
      aria-current={active ? "page" : undefined}
      className={`relative flex items-center px-3 text-sm font-semibold whitespace-nowrap transition-colors ${
        active ? "text-jamun after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-jamun" : "text-ink-2 hover:text-ink"
      }`}
    >
      {label}
    </a>
  );
}
