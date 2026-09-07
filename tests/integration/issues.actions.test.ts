import { randomUUID } from 'node:crypto'

import { UserRole } from '@prisma/client'
import type { Session } from 'next-auth'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Actor } from '@/server/auth/session'
import type { Db } from '@/server/db/prisma'

import { actorFor, createTestUser, testDb, type TestUser } from '../helpers/db'

/**
 * The issue Server Actions and their authorization, through the `action()`
 * wrapper.
 *
 * One long-lived transaction rolled back at the end, with
 * `@/server/db/prisma` proxied onto it and the session stubbed - the same
 * isolation the handover and return action suites use. No test provokes a
 * database-level refusal: that would abort the shared transaction.
 */

class Rollback extends Error {}

let tx: Db
let releaseTransaction: (() => void) | undefined
let transactionReady: () => void = () => {}
const ready = new Promise<void>((resolve) => {
  transactionReady = resolve
})

const transaction = testDb
  .$transaction(
    async (client) => {
      tx = client
      transactionReady()
      await new Promise<void>((_, reject) => {
        releaseTransaction = () => reject(new Rollback())
      })
    },
    { maxWait: 10_000, timeout: 300_000 },
  )
  .catch((error: unknown) => {
    if (!(error instanceof Rollback)) throw error
  })

let currentSession: Session | null = null
vi.mock('@/server/auth/auth', () => ({ auth: vi.fn(async () => currentSession) }))
vi.mock('@/server/db/prisma', () => ({
  prisma: new Proxy({} as Record<string | symbol, unknown>, {
    get: (_target, property) => (tx as unknown as Record<string | symbol, unknown>)[property],
  }),
}))

const {
  assignIssueFormAction,
  closeIssueFormAction,
  createIssueFormAction,
  investigateIssueFormAction,
  reopenIssueFormAction,
  resolveIssueFormAction,
  updateIssueFormAction,
} = await import('@/server/actions/issues.actions')
const { getIssueDetail } = await import('@/server/dal/issues.dal')
const { createAsset } = await import('@/server/services/assets.service')
const { createIssue } = await import('@/server/services/issues.service')

const tag = randomUUID().slice(0, 8).toUpperCase()

function sessionFor(user: TestUser | null): Session | null {
  return user ? { expires: new Date(Date.now() + 60_000).toISOString(), user: { id: user.id, name: user.name, email: user.email, role: user.role } } : null
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

function isRedirect(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'digest' in error && String((error as { digest?: unknown }).digest).startsWith('NEXT_REDIRECT'))
}

async function run(action: (previous: never, data: FormData) => Promise<unknown>, fields: Record<string, string>) {
  try {
    const result = await action(null as never, form(fields))
    return { ok: true, result }
  } catch (error) {
    if (isRedirect(error)) return { ok: true, result: { redirected: true } }
    throw error
  }
}

let admin: TestUser
let engineer: TestUser
let viewer: TestUser
let editorUser: TestUser
let adminActor: Actor
let engineerActor: Actor
let assetId: string
let countersBefore: Array<{ scope: string; current: number }>

/** A fresh open issue to act on. */
async function openIssue(title: string) {
  const issue = await createIssue(tx, engineerActor, {
    type: 'DAMAGED',
    severity: 'MEDIUM',
    title: `ISSUE-ACT ${tag} ${title}`,
    description: 'Created by the action suite.',
    assetId,
    kitId: undefined,
    bookingId: undefined,
    accessoryId: undefined,
    assignedToId: undefined,
  })
  return issue
}

beforeAll(async () => {
  await ready
  countersBefore = await tx.numberSequence.findMany({ select: { scope: true, current: true }, orderBy: { scope: 'asc' } })
  admin = await createTestUser(tx, { role: UserRole.ADMIN })
  engineer = await createTestUser(tx, { role: UserRole.ENGINEER })
  viewer = await createTestUser(tx, { role: UserRole.VIEWER })
  editorUser = await createTestUser(tx, { role: UserRole.EDITOR, withEditorProfile: true })
  adminActor = actorFor(admin)
  engineerActor = actorFor(engineer)

  const category = await tx.equipmentCategory.findFirstOrThrow({ where: { code: 'OTHER_EQUIPMENT' }, select: { id: true } })
  const asset = await createAsset(tx, adminActor, {
    name: `Issue action asset ${tag}`,
    categoryId: category.id,
    manufacturer: 'Testco',
    model: 'IA-1',
    serialNumber: `SN-IA-${tag}`,
    admBarcode: `ADM-IA-${tag}`,
    location: undefined,
    notes: undefined,
    status: 'AVAILABLE',
  })
  assetId = asset.id
})

afterAll(async () => {
  releaseTransaction?.()
  await transaction
  expect(await testDb.numberSequence.findMany({ select: { scope: true, current: true }, orderBy: { scope: 'asc' } })).toEqual(countersBefore)
  expect(await testDb.issue.count({ where: { title: { startsWith: 'ISSUE-ACT' } } })).toBe(0)
  await testDb.$disconnect()
})

describe('authorization', () => {
  it('refuses an anonymous caller, a VIEWER and an EDITOR on every action', async () => {
    const issue = await openIssue('rbac')
    const fields = { issueId: issue.id }

    const attempts: Array<[string, (previous: never, data: FormData) => Promise<unknown>, Record<string, string>]> = [
      ['report', createIssueFormAction, { type: 'DAMAGED', severity: 'LOW', title: 'ISSUE-ACT sneaky', description: 'Should not be created.' }],
      ['investigate', investigateIssueFormAction, fields],
      ['resolve', resolveIssueFormAction, { ...fields, resolution: 'Should not happen.' }],
      ['close', closeIssueFormAction, { ...fields, resolution: 'Should not happen.' }],
      ['reopen', reopenIssueFormAction, { ...fields, reason: 'Should not happen.' }],
      ['assign', assignIssueFormAction, { ...fields, assignedToId: engineer.id }],
      ['update', updateIssueFormAction, { ...fields, type: 'OTHER', severity: 'LOW', title: 'ISSUE-ACT edited', description: 'Should not happen.' }],
    ]

    currentSession = null
    for (const [label, action, payload] of attempts) {
      expect(await run(action, payload), label).toMatchObject({ result: { ok: false, error: 'unauthorized' } })
    }

    for (const user of [viewer, editorUser]) {
      currentSession = sessionFor(user)
      for (const [label, action, payload] of attempts) {
        expect(await run(action, payload), `${user.role}:${label}`).toMatchObject({ result: { ok: false, error: 'forbidden' } })
      }
    }

    // Nothing moved.
    const detail = (await getIssueDetail(tx, issue.id))!
    expect(detail.status).toBe('OPEN')
    expect(detail.assignedTo).toBeNull()
    expect(await tx.issue.count({ where: { title: `ISSUE-ACT ${tag} sneaky` } })).toBe(0)
  })

  it('lets an ENGINEER report and work an issue', async () => {
    currentSession = sessionFor(engineer)

    expect(
      await run(createIssueFormAction, { type: 'MALFUNCTION', severity: 'HIGH', title: `ISSUE-ACT ${tag} engineer report`, description: 'Fan is grinding.', assetId }),
    ).toMatchObject({ ok: true })

    const reported = await tx.issue.findFirstOrThrow({ where: { title: `ISSUE-ACT ${tag} engineer report` }, select: { id: true, issueNumber: true, reportedById: true } })
    expect(reported.issueNumber).toMatch(/^ISS-\d{4}-\d{6}$/)
    expect(reported.reportedById).toBe(engineer.id)

    expect(await run(investigateIssueFormAction, { issueId: reported.id })).toMatchObject({ ok: true })
    expect(await run(resolveIssueFormAction, { issueId: reported.id, resolution: 'Replaced the fan from spares.' })).toMatchObject({ ok: true })

    const detail = (await getIssueDetail(tx, reported.id))!
    expect(detail.status).toBe('RESOLVED')
    expect(detail.assignedTo?.name).toBe(engineer.name)
  })

  it('lets an ADMIN close and reopen one', async () => {
    const issue = await openIssue('admin closes')
    currentSession = sessionFor(admin)

    expect(await run(closeIssueFormAction, { issueId: issue.id, resolution: 'Not a fault - wrong case checked.' })).toMatchObject({ ok: true })
    expect((await getIssueDetail(tx, issue.id))!.status).toBe('CLOSED')

    expect(await run(reopenIssueFormAction, { issueId: issue.id, reason: 'It is a fault after all.' })).toMatchObject({ ok: true })
    expect((await getIssueDetail(tx, issue.id))!.status).toBe('OPEN')
  })
})

describe('what the forms refuse', () => {
  it('rejects incomplete reports and empty resolutions', async () => {
    currentSession = sessionFor(engineer)

    // A title and a description are the minimum.
    expect(await run(createIssueFormAction, { type: 'DAMAGED', severity: 'LOW', title: 'no', description: 'x' })).toMatchObject({ result: { ok: false, error: 'validation' } })
    // An unknown type is not a type.
    expect(await run(createIssueFormAction, { type: 'EXPLODED', severity: 'LOW', title: 'ISSUE-ACT bad type', description: 'Nope.' })).toMatchObject({
      result: { ok: false, error: 'validation' },
    })

    const issue = await openIssue('refusals')
    expect(await run(resolveIssueFormAction, { issueId: issue.id, resolution: '' })).toMatchObject({ result: { ok: false, error: 'validation' } })
    expect(await run(reopenIssueFormAction, { issueId: issue.id, reason: '' })).toMatchObject({ result: { ok: false, error: 'validation' } })
    // Closing something unresolved without a reason is a domain refusal.
    expect(await run(closeIssueFormAction, { issueId: issue.id })).toMatchObject({ result: { ok: false, error: 'rejected' } })
    expect((await getIssueDetail(tx, issue.id))!.status).toBe('OPEN')
  })

  it('reports a lifecycle refusal as a sentence rather than a crash', async () => {
    const issue = await openIssue('lifecycle refusal')
    currentSession = sessionFor(engineer)

    await run(resolveIssueFormAction, { issueId: issue.id, resolution: 'Done.' })
    const again = await run(investigateIssueFormAction, { issueId: issue.id })
    expect(again).toMatchObject({ result: { ok: false, error: 'rejected' } })
    expect(String((again.result as { message?: string }).message)).toMatch(/resolved/i)

    // An unknown id is a plain not-found, not an exception.
    expect(await run(investigateIssueFormAction, { issueId: 'clzzzzzzzzzzzzzzzzzzzzzz' })).toMatchObject({ result: { ok: false, error: 'rejected' } })
  })

  it('refuses an assignee the matrix does not allow', async () => {
    const issue = await openIssue('bad assignee')
    currentSession = sessionFor(engineer)

    expect(await run(assignIssueFormAction, { issueId: issue.id, assignedToId: viewer.id })).toMatchObject({ result: { ok: false, error: 'rejected' } })
    expect((await getIssueDetail(tx, issue.id))!.assignedTo).toBeNull()

    expect(await run(assignIssueFormAction, { issueId: issue.id, assignedToId: admin.id })).toMatchObject({ ok: true })
    expect((await getIssueDetail(tx, issue.id))!.assignedTo?.name).toBe(admin.name)
  })
})
