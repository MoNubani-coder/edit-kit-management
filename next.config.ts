import path from 'node:path'

import type { NextConfig } from 'next'

/**
 * Static security headers.
 *
 * Content-Security-Policy is deliberately NOT set here: a strict policy for the
 * App Router needs a per-request nonce, so it is issued by `src/proxy.ts` on
 * every request (see docs/ARCHITECTURE.md, section 9).
 */
const securityHeaders = [
  // This app is never meant to be framed. Clickjacking on a handover
  // confirmation button would be a real problem.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  {
    key: 'Permissions-Policy',
    // Signature capture needs pointer/touch only - no device APIs.
    value: 'camera=(self), microphone=(), geolocation=(), interest-cohort=()',
  },
]

const productionOnlyHeaders = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
]

const nextConfig: NextConfig = {
  // Required by docker/Dockerfile - emits a self-contained server bundle.
  output: 'standalone',

  // Pin the workspace root. Without this, Turbopack walks up looking for a
  // lockfile, finds a stray package-lock.json in the user's home directory and
  // warns that it would trace the entire home folder.
  turbopack: { root: path.resolve(process.cwd()) },

  reactStrictMode: true,

  // Fail the production build on a type error rather than shipping it.
  typescript: { ignoreBuildErrors: false },

  // forbidden() / unauthorized() and the forbidden.tsx / unauthorized.tsx
  // boundaries used by the page guards (src/server/auth/page-guards.ts).
  experimental: { authInterrupts: true },

  // Keep Prisma's query engine out of the bundler's dependency graph.
  serverExternalPackages: ['@prisma/client', 'prisma'],

  // Uploaded evidence is served through an authorised route handler, never
  // statically, so next/image never needs a remote pattern.
  images: { remotePatterns: [] },

  async headers() {
    const headers =
      process.env.NODE_ENV === 'production'
        ? [...securityHeaders, ...productionOnlyHeaders]
        : securityHeaders

    return [{ source: '/:path*', headers }]
  },
}

export default nextConfig
