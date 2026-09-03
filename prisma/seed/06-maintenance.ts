import {
  MaintenanceStatus,
  MaintenanceType,
  NumberScope,
  PrismaClient,
  UserRole,
} from '@prisma/client'

import { nextNumber } from '../../src/server/services/numbering.service'

/**
 * Sample maintenance record.
 *
 * One SCHEDULED calibration on the broadcast monitor - the asset whose seed
 * notes already say "Recalibration due annually". A scheduled record does not
 * change the asset's status (only IN_PROGRESS does), so the sample kit stays
 * AVAILABLE and bookable.
 */

interface MaintenanceSpec {
  assetSerial: string
  type: MaintenanceType
  status: MaintenanceStatus
  title: string
  description: string
  scheduledInDays: number
  vendor?: string
}

const MAINTENANCE_RECORDS: MaintenanceSpec[] = [
  {
    assetSerial: 'SN-DEMO-MBP02-0009',
    type: MaintenanceType.CALIBRATION,
    status: MaintenanceStatus.SCHEDULED,
    title: 'Annual Rec.709 calibration',
    description:
      'Probe-based calibration of the SmartView 4K2 against a Rec.709 reference. Record delta-E before and after.',
    scheduledInDays: 45,
    vendor: 'Authorised Blackmagic Design service partner',
  },
]

export async function seedMaintenance(prisma: PrismaClient) {
  const admin = await prisma.user.findFirst({
    where: { role: UserRole.ADMIN, deletedAt: null },
    select: { id: true },
  })
  if (!admin) {
    throw new Error('No ADMIN user found - run seedUsers first.')
  }

  let created = 0

  for (const spec of MAINTENANCE_RECORDS) {
    const asset = await prisma.asset.findUnique({
      where: { serialNumber: spec.assetSerial },
      select: { id: true },
    })
    if (!asset) {
      throw new Error(`Asset ${spec.assetSerial} missing - run seedAssets first.`)
    }

    // Maintenance records have no natural key; re-runs match on asset + type + title.
    const existing = await prisma.maintenanceRecord.findFirst({
      where: { assetId: asset.id, type: spec.type, title: spec.title, deletedAt: null },
      select: { id: true },
    })
    if (existing) continue

    const scheduledFor = new Date()
    scheduledFor.setUTCDate(scheduledFor.getUTCDate() + spec.scheduledInDays)

    // Same shared counter the application will use, so seeded and UI-created
    // records form one continuous MNT-YYYY-NNNNNN sequence.
    await prisma.$transaction(async (tx) => {
      await tx.maintenanceRecord.create({
        data: {
          maintenanceNumber: await nextNumber(tx, NumberScope.MAINTENANCE),
          assetId: asset.id,
          type: spec.type,
          status: spec.status,
          title: spec.title,
          description: spec.description,
          scheduledFor,
          vendor: spec.vendor,
          createdById: admin.id,
        },
      })
    })

    created += 1
  }

  return { created, total: MAINTENANCE_RECORDS.length }
}
