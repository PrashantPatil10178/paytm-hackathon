import { linkProps } from "@ph/shared/react";

export function NotFound() {
  return (
    <div className="wrap pt-20 text-center">
      <h1 className="text-3xl font-extrabold">This page doesn't exist</h1>
      <p className="mt-2 text-ink-2">The link may be old. Head back to today's deals.</p>
      <a {...linkProps("/")} className="btn-primary mt-6">
        Go to the home page
      </a>
    </div>
  );
}
