import { LogoMark } from "./Logo.tsx";

export function Footer() {
  return (
    <footer className="mt-16 border-t border-line bg-wash">
      <div className="wrap flex flex-wrap items-center justify-between gap-3 py-6 text-sm text-ink-2">
        <span className="flex items-center gap-2">
          <LogoMark size={20} />
          ShopKart is a demo store for the ResolveAI hackathon build.
        </span>
        <span>Product photos: Unsplash</span>
      </div>
    </footer>
  );
}
