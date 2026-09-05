import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { PageHeader } from '@/components/common/page-header'
import { Alert } from '@/components/ui/alert'
import { EditorForm } from '@/features/editors/components/editor-form'
import { requirePermissionForPage } from '@/server/auth/page-guards'
import { prisma } from '@/server/db/prisma'
import { loadEditorWorkspace } from '@/server/services/editors.service'

export const metadata: Metadata = { title: 'Edit editor' }

export const dynamic = 'force-dynamic'

export default async function EditEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermissionForPage('editor.manage')
  const { id } = await params

  const workspace = await loadEditorWorkspace(prisma, actor, id)
  if (!workspace || workspace.editor.deletedAt) notFound()
  const { editor } = workspace

  return (
    <>
      <PageHeader eyebrow={`Operations / Editors / ${editor.staffId ?? editor.fullName} / Edit`} title={`Edit ${editor.fullName}`} description={editor.staffId ?? undefined} />
      <div className="max-w-4xl space-y-6">
        {editor.linkedUser ? (
          <Alert variant="info" title="Linked to an account">
            This editor is linked to {editor.linkedUser.name}. Unlink the account from the Overview tab before changing the type to external.
          </Alert>
        ) : null}
        <EditorForm
          mode="edit"
          values={{
            id: editor.id,
            fullName: editor.fullName,
            staffId: editor.staffId ?? '',
            email: editor.email ?? '',
            contactNumber: editor.contactNumber ?? '',
            department: editor.department ?? '',
            company: editor.company ?? '',
            type: editor.isExternal ? 'EXTERNAL' : 'INTERNAL',
            notes: editor.notes ?? '',
          }}
          cancelHref={`/editors/${editor.id}`}
        />
      </div>
    </>
  )
}
