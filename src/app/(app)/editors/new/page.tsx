import type { Metadata } from 'next'

import { PageHeader } from '@/components/common/page-header'
import { EditorForm } from '@/features/editors/components/editor-form'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { prisma } from '@/server/db/prisma'
import { loadLinkableUsers } from '@/server/services/editors.service'

export const metadata: Metadata = { title: 'New editor' }

export const dynamic = 'force-dynamic'

export default async function NewEditorPage() {
  await requirePermissionForPage('editor.manage')
  const linkableUsers = await loadLinkableUsers(prisma)

  return (
    <>
      <PageHeader
        eyebrow="Operations / Editors / New"
        title="New editor"
        description="Record who can receive a kit. External editors need no account; an internal editor may optionally be linked to an existing user."
      />
      <div className="max-w-4xl">
        <EditorForm
          mode="create"
          values={{ fullName: '', staffId: '', email: '', contactNumber: '', department: '', company: '', type: 'EXTERNAL', notes: '' }}
          linkableUsers={linkableUsers}
          cancelHref="/editors"
        />
      </div>
    </>
  )
}
