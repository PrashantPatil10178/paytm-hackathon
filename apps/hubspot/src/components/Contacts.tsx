import { shortDay, type Contact, type LeadStatus } from "@ph/shared";
import { linkProps, navigate, useArrivals, usePoll } from "@ph/shared/react";
import { useMemo } from "react";
import { Live, Owner, PageHead } from "./ui.tsx";

type Row = Contact & { deal_ids: number[] };

const STATUS_TONE: Record<LeadStatus, string> = {
  New: "bg-cold-wash text-cold",
  Open: "bg-[#eaf0f6] text-ink-2",
  "In progress": "bg-warm-wash text-warm",
  "Open deal": "bg-orange-wash text-orange-ink",
  Unqualified: "bg-[#eaf0f6] text-ink-2",
  Connected: "bg-[#e5f8f4] text-[#007a69]",
};

const th = "border-b border-line bg-wash px-4 py-3 text-left text-xs font-semibold tracking-wide whitespace-nowrap text-ink uppercase";
const td = "border-b border-line-2 px-4 py-3 align-middle";

export function Contacts() {
  const poll = usePoll<{ contacts: Row[] }>("/crm/contacts");
  const contacts = poll.data?.contacts;
  const ids = useMemo(() => contacts?.map((c) => c.id), [contacts]);
  const fresh = useArrivals(ids);

  return (
    <main className="px-4 py-6 sm:px-6">
      <PageHead title="Contacts" sub={contacts ? `${contacts.length} records` : "Loading contacts…"}>
        <Live error={poll.error} title="This list refreshes every 2 seconds" />
      </PageHead>
      <div className="overflow-x-auto rounded-[3px] border border-line bg-paper">
        <table className="w-full min-w-[960px] border-collapse">
          <thead>
            <tr>
              <th scope="col" className={th}>Name</th>
              <th scope="col" className={th}>Email</th>
              <th scope="col" className={th}>Phone number</th>
              <th scope="col" className={th}>Company</th>
              <th scope="col" className={th}>Lead status</th>
              <th scope="col" className={th}>Contact owner</th>
              <th scope="col" className={th}>Create date</th>
            </tr>
          </thead>
          <tbody>
            {contacts?.map((c) => (
              <tr
                key={c.id}
                className={`cursor-pointer bg-paper hover:bg-wash ${fresh.has(c.id) ? "animate-arrive" : ""}`}
                onClick={(e) => {
                  if (!(e.target as HTMLElement).closest("a")) navigate(`/contacts/${c.id}`);
                }}
              >
                <td className={td}>
                  <a className="link font-semibold" {...linkProps(`/contacts/${c.id}`)}>{c.name}</a>
                  {c.source === "Business enquiry form" && <span className="block text-xs text-ink-2">From the enquiry form</span>}
                </td>
                <td className={td}>{c.email}</td>
                <td className={`${td} whitespace-nowrap tabular-nums`}>{c.phone || "–"}</td>
                <td className={td}>{c.company || "–"}</td>
                <td className={td}>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${STATUS_TONE[c.lead_status]}`}>{c.lead_status}</span>
                </td>
                <td className={td}>
                  <Owner name={c.owner} />
                </td>
                <td className={`${td} whitespace-nowrap text-ink-2`}>{shortDay(c.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
