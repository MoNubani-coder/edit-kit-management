import { PrismaClient } from '@prisma/client'

/**
 * Reference data: equipment categories, accessory types and software.
 *
 * Everything here is seeded as *starting* data, not as fixed system data. An
 * administrator can add, rename, reorder or deactivate any of it from
 * /admin/categories and /admin/software without a deployment - which is the
 * whole point of these tables existing.
 */

const EQUIPMENT_CATEGORIES = [
  { code: 'WORKSTATION', name: 'Workstation', icon: 'laptop', description: 'Editing laptops and desktop workstations' },
  { code: 'DESKTOP_MONITOR', name: 'Desktop Monitor', icon: 'monitor', description: 'Computer displays used for the editing GUI' },
  { code: 'AUDIO_INTERFACE', name: 'Audio Interface', icon: 'sliders-horizontal', description: 'Audio capture and playback interfaces' },
  { code: 'SPEAKER', name: 'Speaker', icon: 'speaker', description: 'Studio monitors and reference speakers' },
  { code: 'MICROPHONE', name: 'Microphone', icon: 'mic', description: 'Voice-over and reference microphones' },
  { code: 'HEADPHONE', name: 'Headphone', icon: 'headphones', description: 'Monitoring headphones' },
  { code: 'VIDEO_INTERFACE', name: 'Video Interface', icon: 'video', description: 'SDI/HDMI capture and playback devices' },
  { code: 'BROADCAST_MONITOR', name: 'Broadcast Monitor', icon: 'tv', description: 'Calibrated broadcast reference displays' },
  { code: 'EXTERNAL_STORAGE', name: 'External Storage', icon: 'hard-drive', description: 'Portable drives and RAID enclosures' },
  { code: 'CARD_READER', name: 'Card Reader', icon: 'memory-stick', description: 'Camera card readers' },
  { code: 'OTHER_EQUIPMENT', name: 'Other Equipment', icon: 'package', description: 'Anything that does not fit another category' },
] as const

const ACCESSORY_TYPES = [
  { code: 'POWER_ADAPTER', name: 'Power Adapter' },
  { code: 'POWER_CABLE', name: 'Power Cable' },
  { code: 'MOUSE', name: 'Mouse' },
  { code: 'KEYBOARD', name: 'Keyboard' },
  { code: 'USB_HUB', name: 'USB Hub' },
  { code: 'HDMI_CABLE', name: 'HDMI Cable' },
  { code: 'XLR_CABLE', name: 'XLR Cable' },
  { code: 'USB_AB_CABLE', name: 'USB AB Cable' },
  { code: 'USB_C_CABLE', name: 'USB-C Cable' },
  { code: 'TYPE_C_TO_TYPE_C_CABLE', name: 'Type-C to Type-C Cable' },
  { code: 'SPEAKER_CABLE', name: 'Speaker Cable' },
  { code: 'AUDIO_CABLE', name: 'Audio Cable' },
  { code: 'CARRY_POUCH', name: 'Carry Pouch' },
  { code: 'OTHER_ACCESSORY', name: 'Other Accessory' },
] as const

const SOFTWARE_APPLICATIONS = [
  {
    name: 'Adobe Premiere Pro',
    version: '2025',
    vendor: 'Adobe',
    licenseType: 'Named-user subscription',
    notes: 'Primary NLE for external edit kits.',
  },
  {
    name: 'Adobe Media Encoder',
    version: '2025',
    vendor: 'Adobe',
    licenseType: 'Named-user subscription',
    notes: 'Required for delivery renders and watch folders.',
  },
] as const

export async function seedCatalogue(prisma: PrismaClient) {
  for (const [index, category] of EQUIPMENT_CATEGORIES.entries()) {
    await prisma.equipmentCategory.upsert({
      where: { code: category.code },
      update: { name: category.name, icon: category.icon, sortOrder: index, deletedAt: null },
      create: { ...category, sortOrder: index },
    })
  }

  for (const [index, accessoryType] of ACCESSORY_TYPES.entries()) {
    await prisma.accessoryType.upsert({
      where: { code: accessoryType.code },
      update: { name: accessoryType.name, sortOrder: index, deletedAt: null },
      create: { ...accessoryType, sortOrder: index },
    })
  }

  for (const [index, software] of SOFTWARE_APPLICATIONS.entries()) {
    await prisma.softwareApplication.upsert({
      where: { name_version: { name: software.name, version: software.version } },
      update: { vendor: software.vendor, sortOrder: index, deletedAt: null },
      create: { ...software, sortOrder: index },
    })
  }

  return {
    categories: EQUIPMENT_CATEGORIES.length,
    accessoryTypes: ACCESSORY_TYPES.length,
    software: SOFTWARE_APPLICATIONS.length,
  }
}

/** Runtime-editable settings surfaced at /admin/settings. */
export async function seedSettings(prisma: PrismaClient) {
  const settings = [
    {
      key: 'app.timezone',
      value: process.env.APP_TIMEZONE ?? 'Asia/Dubai',
      category: 'general',
      description: 'IANA timezone used to render every date in the UI and in PDFs.',
    },
    {
      key: 'booking.defaultLoanDays',
      value: 7,
      category: 'bookings',
      description: 'Default number of days between collection and expected return.',
    },
    {
      key: 'booking.overdueGraceHours',
      value: 24,
      category: 'bookings',
      description: 'Hours past the expected return date before a booking is flagged OVERDUE.',
    },
    {
      key: 'inspection.requireNoteOnException',
      value: true,
      category: 'inspections',
      description: 'Require a note whenever an item is marked MISSING or DAMAGED.',
    },
    {
      key: 'inspection.autoOfferIssueOnException',
      value: true,
      category: 'inspections',
      description: 'Offer to raise an Issue when a returned item degrades from its handover condition.',
    },
  ]

  for (const setting of settings) {
    await prisma.appSetting.upsert({
      where: { key: setting.key },
      update: { description: setting.description, category: setting.category },
      create: setting,
    })
  }

  return settings.length
}
