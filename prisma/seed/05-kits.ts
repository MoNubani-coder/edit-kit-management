import { PrismaClient, SuitcaseStatus } from '@prisma/client'

import { KIT_MBP_02_ASSETS } from './03-assets'

/**
 * The sample kit "External MBP Edit - 02".
 *
 * Note what is NOT here: no equipment is written into the kit as a column. The
 * kit is a name plus a barcode; its contents are `KitAsset` rows, which is what
 * lets an administrator build "External MBP Edit - 03" - or a completely
 * different kind of kit - from the UI alone.
 */

const KIT = {
  kitCode: 'MBP-02',
  name: 'External MBP Edit - 02',
  admBarcode: 'ADM-DEMO-KIT-0002',
  description:
    'Portable MacBook Pro based editing kit issued to external editors, supplied in a wheeled flight case.',
  location: 'Engineering Store - Rack B',
} as const

export async function seedKits(prisma: PrismaClient, defaultChecklistTemplateId: string) {
  const kit = await prisma.kit.upsert({
    where: { kitCode: KIT.kitCode },
    update: {
      name: KIT.name,
      description: KIT.description,
      location: KIT.location,
      defaultChecklistTemplateId,
      isActive: true,
      deletedAt: null,
    },
    create: {
      ...KIT,
      suitcaseStatus: SuitcaseStatus.GOOD,
      defaultChecklistTemplateId,
    },
    select: { id: true },
  })

  // --- Kit contents ----------------------------------------------------------
  const assets = await prisma.asset.findMany({
    where: { serialNumber: { in: KIT_MBP_02_ASSETS.map((spec) => spec.serialNumber) } },
    select: { id: true, serialNumber: true },
  })
  const assetBySerial = new Map(assets.map((asset) => [asset.serialNumber, asset.id]))

  for (const [index, spec] of KIT_MBP_02_ASSETS.entries()) {
    const assetId = assetBySerial.get(spec.serialNumber)
    if (!assetId) {
      throw new Error(`Asset ${spec.serialNumber} missing - run seedAssets first.`)
    }

    await prisma.kitAsset.upsert({
      where: { kitId_assetId: { kitId: kit.id, assetId } },
      update: { slotLabel: spec.slotLabel, sortOrder: index, removedAt: null },
      create: {
        kitId: kit.id,
        assetId,
        slotLabel: spec.slotLabel,
        // The laptop stand is a convenience item, not a required one - it
        // exercises the "not every line blocks handover" path.
        isRequired: spec.categoryCode !== 'OTHER_EQUIPMENT',
        sortOrder: index,
      },
    })
  }

  // --- Software required on this kit ----------------------------------------
  const software = await prisma.softwareApplication.findMany({
    where: { deletedAt: null },
    select: { id: true },
    orderBy: { sortOrder: 'asc' },
  })

  for (const [index, application] of software.entries()) {
    await prisma.kitSoftware.upsert({
      where: {
        kitId_softwareApplicationId: {
          kitId: kit.id,
          softwareApplicationId: application.id,
        },
      },
      update: { sortOrder: index },
      create: {
        kitId: kit.id,
        softwareApplicationId: application.id,
        sortOrder: index,
      },
    })
  }

  return { kitId: kit.id, assets: KIT_MBP_02_ASSETS.length, software: software.length }
}
