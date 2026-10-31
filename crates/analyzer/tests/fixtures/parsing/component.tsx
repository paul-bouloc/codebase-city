import type { ReactNode } from 'react'

export default function Panel({ open, children }: { open: boolean; children: ReactNode }) {
  return <div>{open && children}</div>
}
