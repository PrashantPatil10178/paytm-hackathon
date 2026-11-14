import { rupees, type Product } from "@ph/shared";
import { usePoll } from "@ph/shared/react";
import { Check, Plus, RotateCcw, Star, Truck } from "lucide-react";
import { useState } from "react";
import { useCustomer } from "../store.tsx";

export function Home() {
  const { customer } = useCustomer();
  const poll = usePoll<{ products: Product[] }>("/shop/products", 30_000);
  const products = poll.data?.products;

  return (
    <div className="wrap pt-8 sm:pt-12">
      <section className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
        <h1 className="max-w-[16ch] text-[clamp(2rem,4.6vw,3.25rem)] leading-[1.02] font-extrabold">
          Today's picks{customer ? `, ${customer.name.split(" ")[0]}` : ""}
        </h1>
        <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-2">
          <li className="flex items-center gap-2">
            <Truck size={18} className="text-jamun" aria-hidden /> Free delivery above ₹499
          </li>
          <li className="flex items-center gap-2">
            <RotateCcw size={18} className="text-jamun" aria-hidden /> 7-day easy returns
          </li>
        </ul>
      </section>

      {poll.error && !products && (
        <p className="mt-8 rounded-xl border border-bad/20 bg-bad-wash px-4 py-3 text-bad" role="alert">
          {poll.error}
        </p>
      )}

      <ul className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 sm:gap-x-6 md:grid-cols-3 lg:grid-cols-4">
        {products
          ? products.map((p) => <ProductCard key={p.id} p={p} />)
          : Array.from({ length: 8 }, (_, i) => (
              <li key={i} className="animate-pulse" aria-hidden>
                <div className="aspect-square rounded-2xl bg-wash" />
                <div className="mt-3 h-4 w-3/4 rounded bg-wash" />
                <div className="mt-2 h-5 w-1/3 rounded bg-wash" />
              </li>
            ))}
      </ul>
    </div>
  );
}

function ProductCard({ p }: { p: Product }) {
  const { addToCart } = useCustomer();
  const [added, setAdded] = useState(false);
  const off = Math.round((1 - p.price / p.mrp) * 100);

  return (
    <li className="group flex min-w-0 flex-col">
      <div className="relative aspect-square overflow-hidden rounded-2xl bg-wash">
        <img
          src={p.image}
          alt={p.name}
          loading="lazy"
          className="size-full object-cover transition-transform duration-500 ease-[var(--ease-out)] group-hover:scale-[1.03]"
        />
        {off > 0 && (
          <span className="absolute top-3 left-3 rounded-full bg-marigold px-2.5 py-1 text-xs font-bold text-marigold-ink">{off}% off</span>
        )}
      </div>
      <p className="mt-3 text-xs font-semibold tracking-wide text-ink-3 uppercase">{p.category}</p>
      <h2 className="mt-0.5 font-sans text-[15px] leading-snug font-semibold tracking-normal">{p.name}</h2>
      <p className="mt-1 flex items-center gap-1 text-[13px] text-ink-2">
        <Star size={14} className="fill-marigold text-marigold" aria-hidden />
        <span className="font-semibold text-ink">{p.rating.toFixed(1)}</span>
        <span>({p.reviews.toLocaleString("en-IN")})</span>
      </p>
      <p className="mt-1.5 flex items-baseline gap-2">
        <span className="font-display text-xl font-bold tabular-nums">{rupees(p.price)}</span>
        <s className="text-sm text-ink-3 tabular-nums">{rupees(p.mrp)}</s>
      </p>
      <button
        type="button"
        className={`btn-quiet mt-3 h-10 w-full ${added ? "border-ok/40 bg-ok-wash text-ok hover:bg-ok-wash" : ""}`}
        onClick={() => {
          addToCart();
          setAdded(true);
          setTimeout(() => setAdded(false), 1500);
        }}
      >
        {added ? <Check size={16} aria-hidden /> : <Plus size={16} aria-hidden />}
        {added ? "Added to cart" : "Add to cart"}
      </button>
    </li>
  );
}
