import { describe, expect, it } from 'vitest'

import { loginFieldErrors, loginSchema, newPasswordSchema } from '@/lib/validation/auth'

describe('login schema', () => {
  it('normalises the email to lower case and trims it', () => {
    const parsed = loginSchema.parse({ email: '  Admin@Example.AE ', password: 'x' })
    expect(parsed.email).toBe('admin@example.ae')
  })

  it('reports one message per field for an empty submission', () => {
    const result = loginSchema.safeParse({ email: '', password: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const errors = loginFieldErrors(result.error)
      expect(errors.email).toBeTruthy()
      expect(errors.password).toBeTruthy()
    }
  })

  it('rejects a malformed email', () => {
    expect(loginSchema.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(false)
  })
})

describe('new password policy', () => {
  it('requires at least 12 characters and no surrounding whitespace', () => {
    expect(newPasswordSchema.safeParse('short').success).toBe(false)
    expect(newPasswordSchema.safeParse(' twelve-chars-x ').success).toBe(false)
    expect(newPasswordSchema.safeParse('twelve-chars-x').success).toBe(true)
  })
})
