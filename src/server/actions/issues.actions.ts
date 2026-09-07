'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'

import {
  assignIssueSchema,
  closeIssueSchema,
  createIssueSchema,
  formDataToObject,
  investigateIssueSchema,
  reopenIssueSchema,
  resolveIssueSchema,
  updateIssueSchema,
} from '@/lib/validation/issues'
import { action, type ActionResult } from '@/server/auth/action'
import { prisma } from '@/server/db/prisma'
import { assignIssue, closeIssue, createIssue, reopenIssue, resolveIssue, startInvestigation, updateIssue } from '@/server/services/issues.service'

/**
 * Issue mutations.
 *
 * `issue.create` reports one; `issue.manage` works one. ADMIN and ENGINEER
 * hold both, VIEWER neither - and an EDITOR holds no issue permission at all,
 * so none of these are reachable for them.
 */

export type IssueFormState = ActionResult<void> | null

const issueId = z.object({ issueId: z.string().min(1) })

const createIssueAction = action({
  permission: 'issue.create',
  schema: createIssueSchema,
  async handler({ actor, input }) {
    const issue = await createIssue(prisma, actor, input)
    redirect(`/issues/${issue.id}`)
  },
})

export async function createIssueFormAction(_previous: IssueFormState, formData: FormData): Promise<IssueFormState> {
  return createIssueAction(formDataToObject(formData))
}

const updateIssueAction = action({
  permission: 'issue.manage',
  schema: updateIssueSchema.extend(issueId.shape),
  async handler({ actor, input }) {
    const { issueId: id, ...rest } = input
    await updateIssue(prisma, actor, id, rest)
    redirect(`/issues/${id}`)
  },
})

export async function updateIssueFormAction(_previous: IssueFormState, formData: FormData): Promise<IssueFormState> {
  return updateIssueAction(formDataToObject(formData))
}

const assignIssueAction = action({
  permission: 'issue.manage',
  schema: assignIssueSchema.extend(issueId.shape),
  async handler({ actor, input }) {
    const { issueId: id, ...rest } = input
    await assignIssue(prisma, actor, id, rest)
    redirect(`/issues/${id}`)
  },
})

export async function assignIssueFormAction(_previous: IssueFormState, formData: FormData): Promise<IssueFormState> {
  return assignIssueAction(formDataToObject(formData))
}

const investigateIssueAction = action({
  permission: 'issue.manage',
  schema: investigateIssueSchema.extend(issueId.shape),
  async handler({ actor, input }) {
    const { issueId: id, ...rest } = input
    await startInvestigation(prisma, actor, id, rest)
    redirect(`/issues/${id}`)
  },
})

export async function investigateIssueFormAction(_previous: IssueFormState, formData: FormData): Promise<IssueFormState> {
  return investigateIssueAction(formDataToObject(formData))
}

const resolveIssueAction = action({
  permission: 'issue.manage',
  schema: resolveIssueSchema.extend(issueId.shape),
  async handler({ actor, input }) {
    const { issueId: id, ...rest } = input
    await resolveIssue(prisma, actor, id, rest)
    redirect(`/issues/${id}`)
  },
})

export async function resolveIssueFormAction(_previous: IssueFormState, formData: FormData): Promise<IssueFormState> {
  return resolveIssueAction(formDataToObject(formData))
}

const closeIssueAction = action({
  permission: 'issue.manage',
  schema: closeIssueSchema.extend(issueId.shape),
  async handler({ actor, input }) {
    const { issueId: id, ...rest } = input
    await closeIssue(prisma, actor, id, rest)
    redirect(`/issues/${id}`)
  },
})

export async function closeIssueFormAction(_previous: IssueFormState, formData: FormData): Promise<IssueFormState> {
  return closeIssueAction(formDataToObject(formData))
}

const reopenIssueAction = action({
  permission: 'issue.manage',
  schema: reopenIssueSchema.extend(issueId.shape),
  async handler({ actor, input }) {
    const { issueId: id, ...rest } = input
    await reopenIssue(prisma, actor, id, rest)
    redirect(`/issues/${id}`)
  },
})

export async function reopenIssueFormAction(_previous: IssueFormState, formData: FormData): Promise<IssueFormState> {
  return reopenIssueAction(formDataToObject(formData))
}
