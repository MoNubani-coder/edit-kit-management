import type { UserRole } from '@prisma/client'

/**
 * Auth.js type augmentation.
 *
 * `User` is what the Credentials provider's `authorize` returns; `Session.user`
 * is what the application sees; `JWT` is the encrypted cookie payload. The
 * session carries exactly the four fields the application needs and nothing
 * else - see docs/ARCHITECTURE.md, AD-2.
 */

declare module 'next-auth' {
  interface User {
    id: string
    name: string
    email: string
    role: UserRole
    sessionVersion: number
  }

  interface Session {
    user: {
      id: string
      name: string
      email: string
      role: UserRole
    }
    expires: string
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: UserRole
    sessionVersion?: number
    /** Epoch milliseconds of the sign-in that created this token. */
    authenticatedAt?: number
  }
}
