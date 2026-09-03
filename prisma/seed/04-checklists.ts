import { ChecklistPhase, PrismaClient } from '@prisma/client'

/**
 * Checklist templates.
 *
 * A template is only ever a *starting point*: when a booking is created its
 * items are copied into `BookingChecklistItem`. Editing this template later
 * therefore has no effect on bookings that already exist, which is what keeps
 * historical handover documents truthful.
 */

export const DEFAULT_CHECKLIST_NAME = 'Standard Edit Kit Checklist'

const DEFAULT_CHECKLIST_ITEMS = [
  { label: 'Laptop powers on', phase: ChecklistPhase.BOTH, description: 'Boots to desktop without error.' },
  { label: 'Power adapter tested', phase: ChecklistPhase.BOTH, description: 'Charges the workstation when connected.' },
  { label: 'Monitor tested', phase: ChecklistPhase.BOTH, description: 'Displays a picture at native resolution.' },
  { label: 'Audio interface tested', phase: ChecklistPhase.BOTH, description: 'Recognised by the OS; input and output pass signal.' },
  { label: 'Speakers tested', phase: ChecklistPhase.BOTH, description: 'Both channels produce sound, no distortion.' },
  { label: 'Microphone tested', phase: ChecklistPhase.BOTH, description: 'Captures a clean level.' },
  { label: 'Headphones tested', phase: ChecklistPhase.BOTH, description: 'Both ears, no crackle on the cable.' },
  { label: 'Video interface tested', phase: ChecklistPhase.BOTH, description: 'Outputs to the broadcast monitor.' },
  { label: 'External storage detected', phase: ChecklistPhase.BOTH, description: 'Mounts and passes a read/write check.' },
  { label: 'Card reader tested', phase: ChecklistPhase.BOTH, description: 'Reads a test card.' },
  {
    label: 'Suitcase and foam inserts intact',
    phase: ChecklistPhase.BOTH,
    description: 'Latches, wheels and handle functional; foam not torn.',
  },
  {
    label: 'Project media copied off and workstation wiped',
    phase: ChecklistPhase.RETURN,
    description: 'Return only: confirm no client media remains on the kit.',
  },
] as const

export async function seedChecklists(prisma: PrismaClient) {
  const template = await prisma.checklistTemplate.upsert({
    where: { name: DEFAULT_CHECKLIST_NAME },
    update: { isActive: true, isDefault: true, deletedAt: null },
    create: {
      name: DEFAULT_CHECKLIST_NAME,
      description:
        'Applied to external editing kit handovers and returns unless the kit specifies its own template.',
      isDefault: true,
    },
    select: { id: true },
  })

  for (const [index, item] of DEFAULT_CHECKLIST_ITEMS.entries()) {
    const existing = await prisma.checklistTemplateItem.findFirst({
      where: { templateId: template.id, label: item.label },
      select: { id: true },
    })

    if (existing) {
      await prisma.checklistTemplateItem.update({
        where: { id: existing.id },
        data: { description: item.description, phase: item.phase, sortOrder: index },
      })
      continue
    }

    await prisma.checklistTemplateItem.create({
      data: {
        templateId: template.id,
        label: item.label,
        description: item.description,
        phase: item.phase,
        sortOrder: index,
      },
    })
  }

  return { templateId: template.id, items: DEFAULT_CHECKLIST_ITEMS.length }
}
