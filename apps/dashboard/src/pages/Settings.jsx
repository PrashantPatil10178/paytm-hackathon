import { useEffect, useState } from 'react'
import { Lightbulb, Hand, Rocket, LifeBuoy, TrendingUp, Loader2, Check, Languages, Clock, ShieldAlert } from 'lucide-react'
import { ResolveAIGlyph } from '@ph/shared/brand'
import { api } from '../api'
import { useApp } from '../store'
import { Card, PageHeader, Toggle, Button, Select, Skeleton } from '../components/ui'
import { cn, rupees } from '../lib'

const AUTONOMY = [
  { value: 'suggest', icon: Lightbulb, title: 'Suggest only', text: 'Drafts replies and actions. A human sends every one.' },
  { value: 'approval', icon: Hand, title: 'Act with approval', text: 'Acts on its own within guardrails. Anything above them waits for you.' },
  { value: 'autonomous', icon: Rocket, title: 'Fully autonomous', text: 'Resolves end to end. Humans only see escalations.' },
]
const ESCALATION = [
  { key: 'critical', label: 'Critical tickets', text: 'Severity marked critical on intake' },
  { key: 'fraud', label: 'Fraud signals', text: 'Risk score above 0.7 or repeat refund pattern' },
  { key: 'legal', label: 'Legal threats or abuse', text: 'Consumer court, police, abusive language' },
  { key: 'vip', label: 'VIP customers', text: 'Lifetime value above ₹1,00,000' },
  { key: 'negative', label: 'Angry twice in a row', text: 'Negative sentiment on 2 consecutive messages' },
]
const LANGS = ['English', 'Hindi', 'Hinglish', 'Tamil', 'Telugu', 'Kannada', 'Marathi', 'Bengali', 'Gujarati', 'Malayalam']
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const COLORS = ['#0F9D8A', '#5B6CD6', '#F5A524', '#E5484D', '#0E1B2C']

function Section({ icon: Icon, title, text, children }) {
  return (
    <Card className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-3">
      <div>
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-brand-600" />
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        </div>
        <p className="mt-1 text-sm text-slate-500">{text}</p>
      </div>
      <div className="lg:col-span-2">{children}</div>
    </Card>
  )
}

const Label = ({ children }) => <label className="mb-1.5 block text-xs font-medium text-slate-600">{children}</label>
const inputCls = 'h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-brand-500'

export default function Settings() {
  const { settings, setSettings, toast } = useApp()
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (settings && !form) setForm(structuredClone(settings)) }, [settings, form])

  if (!form) return <div className="space-y-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40" />)}</div>

  const dirty = JSON.stringify(form) !== JSON.stringify(settings)
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const save = async () => {
    setSaving(true)
    await api.saveSettings(form)
    setSettings(structuredClone(form))
    setSaving(false)
    toast({ title: 'Agent settings saved', desc: `${form.agentName} is using the new rules now.` })
  }
  const toggleIn = (list, item) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item])

  return (
    <div className="pb-24">
      <PageHeader title="Agent settings" description="Shape how your AI teammate behaves: its voice, its playbooks and how far it can go on its own." />

      <div className="space-y-4">
        <Section icon={ResolveAIGlyph} title="Profile" text="How the agent introduces itself to customers.">
          <div className="flex flex-wrap items-start gap-6">
            <div className="grid size-16 place-items-center rounded-2xl text-2xl font-semibold text-white shadow-lg transition-colors" style={{ background: form.avatarColor }}>
              {form.agentName?.[0] || '?'}
            </div>
            <div className="grid min-w-0 flex-1 grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label>Agent name</Label>
                <input className={inputCls} value={form.agentName} onChange={(e) => set({ agentName: e.target.value })} />
              </div>
              <div>
                <Label>Tone of voice</Label>
                <Select label="Tone" className="w-full" value={form.tone} onChange={(tone) => set({ tone })} options={['Friendly', 'Professional', 'Concise', 'Warm & empathetic'].map((v) => ({ value: v, label: v }))} />
              </div>
              <div className="sm:col-span-2">
                <Label>Avatar colour</Label>
                <div className="flex gap-2">
                  {COLORS.map((c) => (
                    <button key={c} onClick={() => set({ avatarColor: c })} aria-label={`Colour ${c}`}
                      className={cn('grid size-8 place-items-center rounded-full ring-offset-2 transition', form.avatarColor === c && 'ring-2 ring-slate-900')} style={{ background: c }}>
                      {form.avatarColor === c && <Check className="size-4 text-white" />}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Section>

        <Section icon={LifeBuoy} title="Playbooks" text="Which jobs the agent is allowed to take on.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[
              { key: 'support', icon: LifeBuoy, title: 'Customer support', text: 'Refunds, order tracking, address changes, invoices, complaints.' },
              { key: 'sales', icon: TrendingUp, title: 'Sales', text: 'Qualify leads, answer pricing questions, create deals in the CRM.' },
            ].map((p) => (
              <div key={p.key} className={cn('rounded-xl border p-4 transition', form.playbooks[p.key] ? 'border-brand-200 bg-brand-50/40' : 'border-slate-200')}>
                <div className="flex items-center justify-between">
                  <p.icon className={cn('size-5', form.playbooks[p.key] ? 'text-brand-600' : 'text-slate-400')} />
                  <Toggle checked={form.playbooks[p.key]} onChange={(v) => set({ playbooks: { ...form.playbooks, [p.key]: v } })} label={p.title} />
                </div>
                <p className="mt-3 text-sm font-semibold text-slate-900">{p.title}</p>
                <p className="mt-0.5 text-xs text-slate-500">{p.text}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section icon={Rocket} title="Autonomy" text="How much the agent can do before a human has to step in.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {AUTONOMY.map((a, i) => {
              const on = form.autonomy === a.value
              return (
                <button key={a.value} onClick={() => set({ autonomy: a.value })}
                  className={cn('rounded-xl border p-4 text-left transition', on ? 'border-brand-500 bg-brand-50/50 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300')}>
                  <div className="flex items-center justify-between">
                    <a.icon className={cn('size-5', on ? 'text-brand-600' : 'text-slate-400')} />
                    <div className="flex gap-0.5">
                      {[0, 1, 2].map((d) => <span key={d} className={cn('h-1.5 w-3 rounded-full', d <= i ? (on ? 'bg-brand-500' : 'bg-slate-300') : 'bg-slate-200')} />)}
                    </div>
                  </div>
                  <p className="mt-3 text-sm font-semibold text-slate-900">{a.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{a.text}</p>
                </button>
              )
            })}
          </div>
        </Section>

        <Section icon={ShieldAlert} title="Guardrails" text="Hard limits. Crossing one sends the action to Approvals.">
          <Label>Auto-refund limit</Label>
          <div className="flex items-center gap-4">
            <input type="range" min={0} max={10000} step={100} value={form.refundLimit} onChange={(e) => set({ refundLimit: +e.target.value })} className="flex-1 accent-brand-500" />
            <div className="relative w-32">
              <span className="absolute top-1/2 left-3 -translate-y-1/2 text-sm text-slate-400">₹</span>
              <input type="number" min={0} step={100} value={form.refundLimit} onChange={(e) => set({ refundLimit: Math.max(0, +e.target.value) })} className={cn(inputCls, 'pl-7 tabular')} />
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">Refunds up to <b className="text-slate-700">{rupees(form.refundLimit)}</b> are issued instantly. Larger ones wait for a human.</p>

          <Label><span className="mt-6 block">Always escalate to a human when…</span></Label>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {ESCALATION.map((r) => (
              <li key={r.key} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-800">{r.label}</p>
                  <p className="text-xs text-slate-500">{r.text}</p>
                </div>
                <Toggle checked={form.escalation[r.key]} onChange={(v) => set({ escalation: { ...form.escalation, [r.key]: v } })} label={r.label} />
              </li>
            ))}
          </ul>
        </Section>

        <Section icon={Languages} title="Languages" text="The agent detects the customer's language and replies in it.">
          <div className="flex flex-wrap gap-2">
            {LANGS.map((l) => {
              const on = form.languages.includes(l)
              return (
                <button key={l} onClick={() => set({ languages: toggleIn(form.languages, l) })}
                  className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition', on ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600 hover:border-slate-300')}>
                  {on && <Check className="size-3.5" />}{l}
                </button>
              )
            })}
          </div>
        </Section>

        <Section icon={Clock} title="Business hours" text="When your human team is around to take escalations.">
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d) => {
              const on = form.hours.days.includes(d)
              return (
                <button key={d} onClick={() => set({ hours: { ...form.hours, days: toggleIn(form.hours.days, d) } })}
                  className={cn('h-9 w-12 rounded-lg text-sm font-medium transition', on ? 'bg-slate-900 text-canvas' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}>
                  {d}
                </button>
              )
            })}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:max-w-sm">
            <div><Label>From</Label><input type="time" className={inputCls} value={form.hours.from} onChange={(e) => set({ hours: { ...form.hours, from: e.target.value } })} /></div>
            <div><Label>To</Label><input type="time" className={inputCls} value={form.hours.to} onChange={(e) => set({ hours: { ...form.hours, to: e.target.value } })} /></div>
          </div>
          <div className="mt-4 sm:max-w-md">
            <Label>Outside business hours</Label>
            <Select label="After hours" className="w-full" value={form.hours.afterHours} onChange={(afterHours) => set({ hours: { ...form.hours, afterHours } })} options={[
              { value: 'autonomous', label: 'Keep resolving. Queue escalations for the morning' },
              { value: 'collect', label: 'Collect details only and promise a callback' },
            ]} />
          </div>
        </Section>
      </div>

      <div className={cn('fixed right-0 bottom-0 left-0 z-20 border-t border-slate-200 bg-canvas/85 backdrop-blur-md transition-transform duration-300 lg:left-64', dirty ? 'translate-y-0' : 'translate-y-full')}>
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <span className="size-2 rounded-full bg-amber-500" />
          <p className="flex-1 text-sm text-slate-700">You have unsaved changes</p>
          <Button onClick={() => setForm(structuredClone(settings))}>Discard</Button>
          <Button variant="primary" onClick={save} disabled={saving} icon={saving ? Loader2 : Check} className={saving ? '[&>svg]:animate-spin' : ''}>
            {saving ? 'Saving' : 'Save changes'}
          </Button>
        </div>
      </div>
    </div>
  )
}
