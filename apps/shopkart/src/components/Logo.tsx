/** ShopKart's own mark: a jamun-purple bag with a marigold tag. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="flex-none">
      <rect width="32" height="32" rx="9" fill="var(--color-jamun)" />
      <path d="M9 12h14l-1.4 11H10.4z" fill="white" />
      <path d="M12.5 12a3.5 3.5 0 0 1 7 0" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" />
      <circle cx="24" cy="8" r="3.5" fill="var(--color-marigold)" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2">
      <LogoMark />
      <span className="font-display text-[22px] font-extrabold tracking-[-0.03em] text-ink">
        shop<span className="text-jamun">kart</span>
      </span>
    </span>
  );
}
