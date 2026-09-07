import type { NextRequest } from 'next/server'

import { forbiddenResponse, unauthorizedResponse } from '@/server/auth/api'
import { isAuthorizationError, isServiceUnavailableError } from '@/server/auth/errors'
import { requireAuth } from '@/server/auth/session'
import { prisma } from '@/server/db/prisma'
import type { DocumentKind } from '@/server/documents/snapshot'
import { loadDocument, renderDocument } from '@/server/services/documents.service'

/**
 * The handover or return document as a PDF.
 *
 * `GET /api/documents/handover/<booking id>` and `/api/documents/return/...`.
 * Authorised against the booking (booking.read, or booking.readOwn for that
 * booking's own editor), rendered from the frozen snapshot with the signature
 * images embedded, and served inline so a browser can show it before saving.
 *
 * A booking whose inspection is not complete answers 409 rather than an empty
 * PDF: there is genuinely nothing signed to print yet.
 */

const KINDS = new Set<DocumentKind>(['handover', 'return'])

function notFound(): Response {
  return Response.json({ error: 'not_found', message: 'Document not found.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(_request: NextRequest, context: { params: Promise<{ kind: string; id: string }> }): Promise<Response> {
  const { kind, id } = await context.params
  if (!KINDS.has(kind as DocumentKind)) return notFound()
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

  const access = await loadDocument(prisma, actor, id, kind as DocumentKind)
  if (access.status === 'not-found') return notFound()
  if (access.status === 'forbidden') return forbiddenResponse()
  if (access.status === 'not-ready') {
    return Response.json(
      { error: 'not_ready', message: kind === 'handover' ? 'This booking has no completed handover yet.' : 'This booking has no completed return yet.' },
      { status: 409, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const rendered = await renderDocument(prisma, access)
  return new Response(new Uint8Array(rendered.bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(rendered.bytes.byteLength),
      'Content-Disposition': `inline; filename="${rendered.fileName}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  })
}
