import NextAuth from 'next-auth'
import { NextResponse } from 'next/server'

import { authConfig } from '@/server/auth/auth.config'
import { decideRoute, HOME_PATH, LOGIN_PATH } from '@/server/auth/route-policy'

/**
 * Request-level gate: optimistic access control plus a per-request CSP nonce.
 *
 * "Optimistic" because it trusts the signed session cookie without consulting
 * the database. That is enough to bounce anonymous visitors to /login, send
 * signed-in visitors away from /login and answer 403 for obvious cases, all
 * before any rendering happens. It is a convenience layer: every page, route
 * handler and server action performs its own database-backed check, and
 * Server Functions are POSTs to their page route, so a matcher gap here never
 * removes a security control.
 *
 * Because this layer cannot see the database, it never redirects *towards* an
 * authenticated route on the strength of a cookie alone - /login is always
 * served. The one exception is the root dispatcher below, whose target
 * (/dashboard) re-checks against the database and lands on /login if the
 * session is stale, which terminates after a single hop.
 *
 * Runs on the Node.js runtime (Next.js 16 default for proxy.ts).
 */

const { auth } = NextAuth(authConfig)

const isDevelopment = process.env.NODE_ENV === 'development'

function contentSecurityPolicy(nonce: string): string {
  const directives = [
    `default-src 'self'`,
    // strict-dynamic: only nonce-bearing scripts (and what they load) run.
    // unsafe-eval is a development-only allowance for React's error overlay.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ''}`,
    // React sets inline style attributes; a nonce cannot cover attributes, so
    // styles allow inline. Scripts are where XSS does its damage, and those
    // are locked down above.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data:`,
    `font-src 'self'`,
    `connect-src 'self'${isDevelopment ? ' ws: wss:' : ''}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    ...(isDevelopment ? [] : [`upgrade-insecure-requests`]),
  ]
  return directives.join('; ')
}

function withSecurityHeaders(response: NextResponse, csp: string): NextResponse {
  response.headers.set('Content-Security-Policy', csp)
  return response
}

export default auth((request) => {
  const { pathname, search } = request.nextUrl

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const csp = contentSecurityPolicy(nonce)

  const subject = request.auth?.user?.role ? { role: request.auth.user.role } : null

  // The root is a pure dispatcher.
  if (pathname === '/') {
    return withSecurityHeaders(
      NextResponse.redirect(new URL(subject ? HOME_PATH : LOGIN_PATH, request.url)),
      csp,
    )
  }

  const decision = decideRoute(pathname, subject)
  // Route handlers speak JSON: a browser redirect to the login page is the
  // wrong answer for a fetch() call.
  const isApiRoute = pathname.startsWith('/api/')

  switch (decision.action) {
    case 'login': {
      if (isApiRoute) {
        return withSecurityHeaders(
          NextResponse.json(
            { error: 'unauthorized', message: 'Authentication required.' },
            { status: 401, headers: { 'Cache-Control': 'no-store' } },
          ),
          csp,
        )
      }
      const loginUrl = new URL(LOGIN_PATH, request.url)
      loginUrl.searchParams.set('callbackUrl', `${pathname}${search}`)
      return withSecurityHeaders(NextResponse.redirect(loginUrl), csp)
    }

    case 'forbidden': {
      if (isApiRoute) {
        return withSecurityHeaders(
          NextResponse.json(
            { error: 'forbidden', message: 'You do not have permission to access this resource.' },
            { status: 403, headers: { 'Cache-Control': 'no-store' } },
          ),
          csp,
        )
      }
      // Render the 403 page in place with a real 403 status. The page itself
      // re-checks against the database and reaches the same conclusion.
      const forbiddenUrl = new URL('/forbidden', request.url)
      return withSecurityHeaders(NextResponse.rewrite(forbiddenUrl, { status: 403 }), csp)
    }

    case 'allow': {
      const requestHeaders = new Headers(request.headers)
      requestHeaders.set('x-nonce', nonce)
      requestHeaders.set('Content-Security-Policy', csp)

      const response = NextResponse.next({ request: { headers: requestHeaders } })
      return withSecurityHeaders(response, csp)
    }
  }
})

export const config = {
  matcher: [
    // Everything except Next.js internals, static assets and metadata files.
    // /api routes ARE included: /api/health and /api/auth are public by policy,
    // other handlers get the optimistic check like any page.
    {
      source: '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
}
