import { withApiAuth } from '@/server/auth/api'
import { permissionsFor } from '@/server/auth/permissions'

/**
 * GET /api/me - who am I and what may I do.
 *
 * The reference protected route handler: 401 without a session, otherwise the
 * actor DTO and the effective permission list. Also the quickest way to check
 * a session from the command line.
 */

export const dynamic = 'force-dynamic'

export const GET = withApiAuth('authenticated', ({ actor }) =>
  Response.json(
    {
      user: { id: actor.id, name: actor.name, email: actor.email, role: actor.role },
      permissions: permissionsFor(actor.role),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  ),
)
