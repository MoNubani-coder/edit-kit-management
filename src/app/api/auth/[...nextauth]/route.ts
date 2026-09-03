import { handlers } from '@/server/auth/auth'

/**
 * Auth.js route handler: /api/auth/* (session, csrf, signin, signout,
 * callback, providers). Public by route policy - the endpoints authenticate
 * themselves.
 */
export const { GET, POST } = handlers
