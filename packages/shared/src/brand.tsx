/**
 * ResolveAI logo as React components. One source for every app; the SVG files live in ../brand/.
 *
 * "Green badge": the outline of a tool's app tile, left open at the top-right corner and closed by
 * Aria's green presence dot. Every support tool shows you a red badge; this one is already green.
 *
 * Usage
 * - <ResolveAIMark />   app icon (white tile, ink ring, mint dot). Sidebar logo, favicon, anywhere the brand stands alone. Min 16px.
 * - <ResolveAIGlyph />  ring + dot in `currentColor`; pass `dot` to colour the dot separately (e.g. BRAND.mint).
 *                       Bot avatars, AI chips, inline "Powered by". Min 12px.
 * Keep the mark's tile white in both themes; the dot is the only colour.
 */
import { useId, type SVGProps } from "react";

export const BRAND = { mint: "#3ecf8e", mintDeep: "#17a56e", ink: "#0c0c0f" } as const;

type Props = SVGProps<SVGSVGElement> & { size?: number | string; title?: string };

const RING = "M17 7h-6a7 7 0 0 0-7 7v7a7 7 0 0 0 7 7h7a7 7 0 0 0 7-7v-6";

function a11y(title?: string) {
  return title ? { role: "img", "aria-label": title } : { "aria-hidden": true as const };
}

/** The glyph alone: ring and dot in the current text colour, unless `dot` sets the dot's colour. */
export function ResolveAIGlyph({ size, title, dot = "currentColor", ...rest }: Props & { dot?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} fill="none" {...a11y(title)} {...rest}>
      {title && <title>{title}</title>}
      <path d={RING} stroke="currentColor" strokeWidth={4} />
      <circle cx="24.4" cy="7.6" r="5" fill={dot} />
    </svg>
  );
}

/** The app icon: the glyph on a white tile with a hairline edge and the mint dot. */
export function ResolveAIMark({ size = 32, title, ...rest }: Props) {
  // Gradient ids must be unique per instance on the page.
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} {...a11y(title)} {...rest}>
      {title && <title>{title}</title>}
      <defs>
        <linearGradient id={`${id}t`} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#fff" />
          <stop offset="1" stopColor="#e6e6eb" />
        </linearGradient>
        <linearGradient id={`${id}d`} x1="0" y1="2.6" x2="0" y2="12.6" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4fe0a0" />
          <stop offset="1" stopColor={BRAND.mintDeep} />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${id}t)`} />
      <rect x=".5" y=".5" width="31" height="31" rx="7.5" fill="none" stroke="#09090b" strokeOpacity=".1" />
      <g transform="translate(4.7 4.3) scale(.72)">
        <path d={RING} fill="none" stroke={BRAND.ink} strokeWidth={4} />
        <circle cx="24.4" cy="7.6" r="5" fill={`url(#${id}d)`} />
      </g>
    </svg>
  );
}
