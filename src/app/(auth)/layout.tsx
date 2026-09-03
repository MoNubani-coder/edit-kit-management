import type { ReactNode } from 'react'

/** Centered, chrome-free frame for the sign-in flow. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-100 px-4 py-12">
      {children}
    </main>
  )
}
