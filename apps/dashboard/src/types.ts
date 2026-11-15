// Shapes of the Control Room's data, as src/api.ts returns it. They are the demo API's /control-room/*
// contract and live in @ph/shared (packages/shared/src/controlroom.ts); only UI-only types are here.
export * from '@ph/shared/controlroom'

export interface Toast {
  id: string
  tone: 'success' | 'neutral'
  title: string
  desc?: string
  action?: { label: string; onClick: () => void }
}
