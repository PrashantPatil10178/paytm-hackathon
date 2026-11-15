import type { Attachment } from '@ph/shared'
import { cn } from '../lib'

/** Photos a customer sent in the chat (damage claims), as thumbnails that open full size. Served by the API. */
export default function Photos({ items, size = 'size-20', label = 'from the customer' }: { items: Attachment[]; size?: string; label?: string }) {
  if (!items.length) return null
  return (
    <ul className="mb-1.5 flex flex-wrap gap-1.5" aria-label={`${items.length} photo${items.length === 1 ? '' : 's'} ${label}`}>
      {items.map((a, i) => (
        <li key={a.id}>
          <a href={`/api${a.url}`} target="_blank" rel="noreferrer" className={cn('block overflow-hidden rounded-lg bg-ink/[0.04] ring-1 ring-ink/10 transition-shadow hover:ring-2 hover:ring-brand-500', size)}>
            <img src={`/api${a.url}`} alt={`Photo ${i + 1} ${label}`} loading="lazy" className="size-full object-cover" />
          </a>
        </li>
      ))}
    </ul>
  )
}
