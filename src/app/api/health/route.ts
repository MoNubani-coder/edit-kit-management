import { NextResponse } from 'next/server'

import { prisma } from '@/server/db/prisma'

/**
 * Liveness/readiness probe.
 *
 * Referenced by the HEALTHCHECK in docker/Dockerfile and intended for the
 * corporate load balancer.
 *
 * Deliberately says nothing beyond up/down: no version, no connection string,
 * no error text. An unauthenticated endpoint that echoes database errors is a
 * reconnaissance gift.
 */

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`

    return NextResponse.json(
      { status: 'ok', timestamp: new Date().toISOString() },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    // Logged server-side in full; never returned to the caller.
    console.error('[health] database check failed', error)

    return NextResponse.json(
      { status: 'unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
