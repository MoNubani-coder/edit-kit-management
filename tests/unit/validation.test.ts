import { describe, expect, it } from 'vitest'

import { loginFieldErrors, loginSchema, newPasswordSchema } from '@/lib/validation/auth'

describe('login schema', () => {
  it('normalises the sign-in name to lower case and trims it', () => {
    const parsed = loginSchema.parse({ username: '  Admin@Example.AE ', password: 'x' })
    expect(parsed.username).toBe('admin@example.ae')
  })

  it('accepts a corporate username as well as an email, and leaves the difference to the server', () => {
    expect(loginSchema.parse({ username: 'K.Mansoori', password: 'x' }).username).toBe('k.mansoori')
    expect(loginSchema.parse({ username: 'CORP\\kmansoori', password: 'x' }).username).toBe('corp\\kmansoori')
  })

  it('reports one message per field for an empty submission', () => {
    const result = loginSchema.safeParse({ username: '', password: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const errors = loginFieldErrors(result.error)
      expect(errors.username).toBeTruthy()
      expect(errors.password).toBeTruthy()
    }
  })

  it('caps an absurdly long name rather than passing it on', () => {
    expect(loginSchema.safeParse({ username: 'a'.repeat(255), password: 'x' }).success).toBe(false)
  })
})

describe('new password policy', () => {
  it('requires at least 12 characters and no surrounding whitespace', () => {
    expect(newPasswordSchema.safeParse('short').success).toBe(false)
    expect(newPasswordSchema.safeParse(' twelve-chars-x ').success).toBe(false)
    expect(newPasswordSchema.safeParse('twelve-chars-x').success).toBe(true)
  })
})
