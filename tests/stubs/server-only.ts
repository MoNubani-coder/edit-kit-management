/**
 * Stand-in for the `server-only` package under Vitest. The real module throws
 * outside a React Server Components bundle; here the guard is a no-op because
 * the whole test process is the server.
 */
export {}
