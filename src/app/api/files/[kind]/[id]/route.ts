import type { NextRequest } from 'next/server'

import { forbiddenResponse, unauthorizedResponse } from '@/server/auth/api'
import { isAuthorizationError, isServiceUnavailableError } from '@/server/auth/errors'
import { requireAuth } from '@/server/auth/session'
import { prisma } from '@/server/db/prisma'
import { type FileKind, loadAuthorisedFile } from '@/server/services/files.service'

/**
 * The authorised file route: signature images and operational photos.
 *
 * `GET /api/files/signature/<id>` and `/api/files/photo/<id>`. The id is an
 * opaque row id - never a path - and the caller is checked against the booking
 * the file belongs to before the bytes are read (files.service.ts).
 *
 * Headers are deliberately dull: the stored (sniffed) type, `nosniff`,
 * `inline` with a generated filename, and `private, no-store` so a shared
 * device or proxy keeps nothing. Nothing in the response reveals where the
 * file lives.
 */

const KINDS = new Set<FileKind>(['signature', 'photo'])

function notFound(): Response {
  return Response.json({ error: 'not_found', message: 'File not found.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(_request: NextRequest, context: { params: Promise<{ kind: string; id: string }> }): Promise<Response> {
  const { kind, id } = await context.params
  if (!KINDS.has(kind as FileKind)) return notFound()
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return notFound()

  let actor
  try {
    actor = await requireAuth()
  } catch (error) {
    if (isAuthorizationError(error)) return error.status === 401 ? unauthorizedResponse() : forbiddenResponse()
    if (isServiceUnavailableError(error)) {
      return Response.json(
        { error: 'unavailable', message: 'The service is temporarily unavailable. Please try again in a moment.' },
        { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' } },
      )
    }
    throw error
  }

  const result = await loadAuthorisedFile(prisma, actor, kind as FileKind, id)
  if (result.status === 'not-found') return notFound()
  if (result.status === 'forbidden') return forbiddenResponse()
  if (result.status === 'gone') {
    // The row is real but the file is not on the store any more. Say so
    // plainly rather than failing: a restored database can look like this.
    return Response.json({ error: 'gone', message: 'That file is no longer stored.' }, { status: 410, headers: { 'Cache-Control': 'no-store' } })
  }

  const body = new Uint8Array(result.bytes)
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': result.mimeType,
      'Content-Length': String(body.byteLength),
      'Content-Disposition': `inline; filename="${result.fileName}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; sandbox",
      'Referrer-Policy': 'no-referrer',
    },
  })
}
