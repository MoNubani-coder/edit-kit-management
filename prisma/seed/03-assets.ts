import { NumberScope, PrismaClient } from '@prisma/client'

import { nextNumber } from '../../src/server/services/numbering.service'

/**
 * Sample assets and their accessories.
 *
 * IMPORTANT: every serial number and barcode below is a synthetic placeholder in
 * an obviously-fake `SN-DEMO-*` / `ADM-DEMO-*` format. No real asset identifiers
 * belong in a seed file - it is committed to source control and copied into
 * every developer's database.
 */

interface AccessorySpec {
  /** `AccessoryType.code` from 02-catalogue.ts */
  typeCode: string
  label?: string
  quantity?: number
  isRequired?: boolean
}

export interface AssetSpec {
  /** Slot name shown on the handover form, e.g. "Speaker 1". */
  slotLabel: string
  categoryCode: string
  name: string
  manufacturer: string
  model: string
  serialNumber: string
  admBarcode: string
  notes?: string
  accessories: AccessorySpec[]
}

/** Contents of the sample kit "External MBP Edit - 02". */
export const KIT_MBP_02_ASSETS: AssetSpec[] = [
  {
    slotLabel: 'Workstation',
    categoryCode: 'WORKSTATION',
    name: 'MacBook Pro 16" M3 Max',
    manufacturer: 'Apple',
    model: 'MacBook Pro 16-inch (2024)',
    serialNumber: 'SN-DEMO-MBP02-0001',
    admBarcode: 'ADM-DEMO-100001',
    notes: '64 GB unified memory / 2 TB SSD.',
    accessories: [
      { typeCode: 'POWER_ADAPTER', label: '140W USB-C Power Adapter' },
      { typeCode: 'TYPE_C_TO_TYPE_C_CABLE', label: 'USB-C Charge Cable (2m)' },
      { typeCode: 'MOUSE', label: 'Wireless Mouse' },
      { typeCode: 'KEYBOARD', label: 'Wireless Keyboard' },
      { typeCode: 'USB_HUB', label: '7-Port USB-C Hub' },
    ],
  },
  {
    slotLabel: 'Desktop Monitor',
    categoryCode: 'DESKTOP_MONITOR',
    name: 'UltraSharp 27" 4K Monitor',
    manufacturer: 'Dell',
    model: 'U2723QE',
    serialNumber: 'SN-DEMO-MBP02-0002',
    admBarcode: 'ADM-DEMO-100002',
    accessories: [
      { typeCode: 'POWER_CABLE', label: 'IEC Power Cable' },
      { typeCode: 'HDMI_CABLE', label: 'HDMI 2.1 Cable (2m)' },
      { typeCode: 'USB_C_CABLE', label: 'USB-C Upstream Cable' },
    ],
  },
  {
    slotLabel: 'Audio Interface',
    categoryCode: 'AUDIO_INTERFACE',
    name: 'Scarlett 18i20 Audio Interface',
    manufacturer: 'Focusrite',
    model: 'Scarlett 18i20 (3rd Gen)',
    serialNumber: 'SN-DEMO-MBP02-0003',
    admBarcode: 'ADM-DEMO-100003',
    accessories: [
      { typeCode: 'POWER_ADAPTER', label: 'DC Power Adapter' },
      { typeCode: 'USB_AB_CABLE', label: 'USB-A to USB-B Cable' },
    ],
  },
  {
    slotLabel: 'Speaker 1',
    categoryCode: 'SPEAKER',
    name: 'HS5 Studio Monitor (Left)',
    manufacturer: 'Yamaha',
    model: 'HS5',
    serialNumber: 'SN-DEMO-MBP02-0004',
    admBarcode: 'ADM-DEMO-100004',
    accessories: [
      { typeCode: 'POWER_CABLE', label: 'IEC Power Cable' },
      { typeCode: 'AUDIO_CABLE', label: 'TRS to TRS Cable (3m)' },
    ],
  },
  {
    slotLabel: 'Speaker 2',
    categoryCode: 'SPEAKER',
    name: 'HS5 Studio Monitor (Right)',
    manufacturer: 'Yamaha',
    model: 'HS5',
    serialNumber: 'SN-DEMO-MBP02-0005',
    admBarcode: 'ADM-DEMO-100005',
    accessories: [
      { typeCode: 'POWER_CABLE', label: 'IEC Power Cable' },
      { typeCode: 'AUDIO_CABLE', label: 'TRS to TRS Cable (3m)' },
    ],
  },
  {
    slotLabel: 'Microphone',
    categoryCode: 'MICROPHONE',
    name: 'NT-USB Mini Microphone',
    manufacturer: 'Rode',
    model: 'NT-USB Mini',
    serialNumber: 'SN-DEMO-MBP02-0006',
    admBarcode: 'ADM-DEMO-100006',
    accessories: [
      { typeCode: 'USB_C_CABLE', label: 'USB-C Cable (1.5m)' },
      { typeCode: 'CARRY_POUCH', label: 'Microphone Pouch', isRequired: false },
    ],
  },
  {
    slotLabel: 'Headphone',
    categoryCode: 'HEADPHONE',
    name: 'MDR-7506 Monitoring Headphones',
    manufacturer: 'Sony',
    model: 'MDR-7506',
    serialNumber: 'SN-DEMO-MBP02-0007',
    admBarcode: 'ADM-DEMO-100007',
    accessories: [{ typeCode: 'CARRY_POUCH', label: 'Headphone Pouch', isRequired: false }],
  },
  {
    slotLabel: 'Video Interface',
    categoryCode: 'VIDEO_INTERFACE',
    name: 'UltraStudio Monitor 3G',
    manufacturer: 'Blackmagic Design',
    model: 'UltraStudio Monitor 3G',
    serialNumber: 'SN-DEMO-MBP02-0008',
    admBarcode: 'ADM-DEMO-100008',
    accessories: [
      { typeCode: 'POWER_ADAPTER', label: 'DC Power Adapter' },
      { typeCode: 'TYPE_C_TO_TYPE_C_CABLE', label: 'Thunderbolt Cable (1m)' },
      { typeCode: 'HDMI_CABLE', label: 'HDMI Cable (2m)' },
    ],
  },
  {
    slotLabel: 'Broadcast Monitor',
    categoryCode: 'BROADCAST_MONITOR',
    name: 'SmartView 4K2 Broadcast Monitor',
    manufacturer: 'Blackmagic Design',
    model: 'SmartView 4K2',
    serialNumber: 'SN-DEMO-MBP02-0009',
    admBarcode: 'ADM-DEMO-100009',
    notes: 'Calibrated Rec.709. Recalibration due annually.',
    accessories: [
      { typeCode: 'POWER_CABLE', label: 'IEC Power Cable' },
      { typeCode: 'HDMI_CABLE', label: 'HDMI Cable (2m)' },
    ],
  },
  {
    slotLabel: 'External Storage',
    categoryCode: 'EXTERNAL_STORAGE',
    name: 'G-DRIVE Professional 4TB',
    manufacturer: 'SanDisk Professional',
    model: 'G-DRIVE 4TB',
    serialNumber: 'SN-DEMO-MBP02-0010',
    admBarcode: 'ADM-DEMO-100010',
    accessories: [
      { typeCode: 'POWER_ADAPTER', label: 'DC Power Adapter' },
      { typeCode: 'USB_C_CABLE', label: 'USB-C Cable (1m)' },
    ],
  },
  {
    slotLabel: 'Card Reader',
    categoryCode: 'CARD_READER',
    name: 'MRW-G1 CFexpress Type B Reader',
    manufacturer: 'Sony',
    model: 'MRW-G1',
    serialNumber: 'SN-DEMO-MBP02-0011',
    admBarcode: 'ADM-DEMO-100011',
    accessories: [{ typeCode: 'USB_C_CABLE', label: 'USB-C Cable (1m)' }],
  },
  {
    slotLabel: 'Laptop Stand',
    categoryCode: 'OTHER_EQUIPMENT',
    name: 'Aluminium Laptop Stand',
    manufacturer: 'Rain Design',
    model: 'mStand360',
    serialNumber: 'SN-DEMO-MBP02-0012',
    admBarcode: 'ADM-DEMO-100012',
    accessories: [],
  },
]

export async function seedAssets(prisma: PrismaClient, specs: AssetSpec[] = KIT_MBP_02_ASSETS) {
  const categories = await prisma.equipmentCategory.findMany({ select: { id: true, code: true } })
  const categoryByCode = new Map(categories.map((c) => [c.code, c.id]))

  const accessoryTypes = await prisma.accessoryType.findMany({ select: { id: true, code: true } })
  const accessoryTypeByCode = new Map(accessoryTypes.map((t) => [t.code, t.id]))

  let created = 0

  for (const spec of specs) {
    const categoryId = categoryByCode.get(spec.categoryCode)
    if (!categoryId) {
      throw new Error(`Unknown equipment category "${spec.categoryCode}" - run seedCatalogue first.`)
    }

    const existing = await prisma.asset.findUnique({
      where: { serialNumber: spec.serialNumber },
      select: { id: true },
    })

    // Asset codes come from the shared counter, so seeded assets and assets
    // created later in the UI share one continuous AST-NNNNNN sequence.
    const assetId = existing
      ? existing.id
      : (
          await prisma.asset.create({
            data: {
              assetCode: await nextNumber(prisma, NumberScope.ASSET),
              categoryId,
              name: spec.name,
              manufacturer: spec.manufacturer,
              model: spec.model,
              serialNumber: spec.serialNumber,
              admBarcode: spec.admBarcode,
              notes: spec.notes,
            },
            select: { id: true },
          })
        ).id

    if (!existing) created += 1

    for (const [index, accessory] of spec.accessories.entries()) {
      const accessoryTypeId = accessoryTypeByCode.get(accessory.typeCode)
      if (!accessoryTypeId) {
        throw new Error(`Unknown accessory type "${accessory.typeCode}" - run seedCatalogue first.`)
      }

      // Accessories have no natural unique key (two identical cables on one
      // asset are legitimate), so re-runs match on asset + type + label.
      const existingAccessory = await prisma.accessory.findFirst({
        where: { assetId, accessoryTypeId, label: accessory.label ?? null },
        select: { id: true },
      })

      if (existingAccessory) continue

      await prisma.accessory.create({
        data: {
          assetId,
          accessoryTypeId,
          label: accessory.label,
          quantity: accessory.quantity ?? 1,
          isRequired: accessory.isRequired ?? true,
          sortOrder: index,
        },
      })
    }
  }

  return { assetsCreated: created, assetsTotal: specs.length }
}
