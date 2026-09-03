import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Setup' }

/**
 * Placeholder root page for Phase 1.
 *
 * Replaced in Phase 2 by a redirect: signed-in users go to /dashboard,
 * everyone else to /login.
 */

const PHASE_ONE_DELIVERABLES = [
  'PostgreSQL schema — 26 models, 17 enums',
  'Integrity constraints, triggers and search indexes',
  'Idempotent seed data (users, catalogue, assets, kit MBP-02)',
  'Docker Compose stack and production Dockerfile',
  'Numbering service (BK-YYYY-NNNNNN, AST-NNNNNN, ISS-YYYY-NNNNNN)',
]

export default function SetupPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-16">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
        Phase 1 of 13 — Architecture &amp; database
      </p>

      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
        Edit Kit Management System
      </h1>

      <p className="mt-3 text-slate-600">
        The data layer is in place. Authentication, the dashboard and the
        handover workflow arrive in the phases that follow.
      </p>

      <ul className="mt-8 space-y-2 border-t border-slate-200 pt-6">
        {PHASE_ONE_DELIVERABLES.map((item) => (
          <li key={item} className="flex gap-3 text-sm text-slate-700">
            <span aria-hidden className="text-slate-400">
              &#10003;
            </span>
            {item}
          </li>
        ))}
      </ul>

      <p className="mt-8 text-sm text-slate-500">
        See <code className="rounded bg-slate-200 px-1.5 py-0.5">DEVELOPMENT.md</code>{' '}
        for setup steps and what to verify.
      </p>
    </main>
  )
}
