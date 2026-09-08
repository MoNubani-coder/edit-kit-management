import 'server-only'

import { PDFDocument, type PDFFont, type PDFImage, type PDFPage, rgb, StandardFonts } from 'pdf-lib'

import { formatDate, formatDateTime } from '@/lib/datetime'

import { documentTitle, type FrozenDocument } from './snapshot'

/**
 * The handover / return PDF, drawn from the frozen snapshot (AD-6).
 *
 * `pdf-lib` rather than a headless browser: no Chromium to install, no font
 * files to bundle, deterministic output, and it embeds the signature PNGs
 * directly so the file is self-contained - which is the point of a document
 * that may be produced in an equipment dispute years later.
 *
 * Nothing enters this renderer that did not come from the snapshot, plus the
 * signature images the caller has already been authorised to read. No storage
 * paths, no hashes, no audit payloads.
 */

const A4 = { width: 595.28, height: 841.89 } as const
const MARGIN = 44
const INK = rgb(0.06, 0.11, 0.2)
const MUTED = rgb(0.42, 0.46, 0.53)
const RULE = rgb(0.82, 0.85, 0.89)
const ACCENT = rgb(0.05, 0.45, 0.45)
const WARN = rgb(0.7, 0.24, 0.2)

export interface SignatureImage {
  type: string
  bytes: Buffer
  mimeType: string
}

export interface PdfOptions {
  organisation: string
  applicationName: string
  timeZone: string
  generatedAt: Date
  signatures: SignatureImage[]
}

const STATUS_WORDS: Record<string, string> = {
  INCLUDED: 'Handed over',
  MISSING: 'Not returned',
  DAMAGED: 'Damaged',
  NOT_APPLICABLE: 'n/a',
  PASS: 'Pass',
  FAIL: 'Fail',
  INSTALLED: 'Installed',
  NOT_INSTALLED: 'Not installed',
  LICENSE_ISSUE: 'Licence issue',
  NEEDS_UPDATE: 'Needs update',
  GOOD: 'Good',
  MINOR_DAMAGE: 'Minor damage',
}

const word = (value: string | null, fallback = '—'): string => (value ? (STATUS_WORDS[value] ?? value.toLowerCase().replace(/_/g, ' ')) : fallback)

/** Return condition wording, where INCLUDED means it came back. */
const returnWord = (value: string | null): string => (value === 'INCLUDED' ? 'Returned' : word(value))

function when(value: string | null, timeZone: string, withTime = true): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return withTime ? formatDateTime(date, timeZone) : formatDate(date, timeZone)
}

/** A tiny layout cursor: pages are added as the content runs past the margin. */
class Sheet {
  private page: PDFPage
  private y: number
  readonly pages: PDFPage[] = []

  constructor(
    private readonly doc: PDFDocument,
    private readonly regular: PDFFont,
    private readonly bold: PDFFont,
    private readonly mono: PDFFont,
  ) {
    this.page = this.newPage()
    this.y = A4.height - MARGIN
  }

  private newPage(): PDFPage {
    const page = this.doc.addPage([A4.width, A4.height])
    this.pages.push(page)
    return page
  }

  get width(): number {
    return A4.width - MARGIN * 2
  }

  get current(): PDFPage {
    return this.page
  }

  get cursor(): number {
    return this.y
  }

  /** Reserves vertical space, starting a new page when it will not fit. */
  need(height: number): void {
    if (this.y - height < MARGIN + 28) {
      this.page = this.newPage()
      this.y = A4.height - MARGIN
    }
  }

  down(amount: number): void {
    this.y -= amount
  }

  text(value: string, options: { size?: number; font?: 'regular' | 'bold' | 'mono'; color?: ReturnType<typeof rgb>; x?: number; maxWidth?: number } = {}): void {
    const size = options.size ?? 9.5
    const font = options.font === 'bold' ? this.bold : options.font === 'mono' ? this.mono : this.regular
    const lines = this.wrap(value, font, size, options.maxWidth ?? this.width)
    for (const line of lines) {
      this.need(size + 4)
      this.page.drawText(line, { x: options.x ?? MARGIN, y: this.y - size, size, font, color: options.color ?? INK })
      this.y -= size + 3
    }
  }

  /** Draws one cell without moving the cursor, for table rows. */
  cell(value: string, x: number, width: number, options: { size?: number; font?: 'regular' | 'bold' | 'mono'; color?: ReturnType<typeof rgb>; baseline: number }): void {
    const size = options.size ?? 8.5
    const font = options.font === 'bold' ? this.bold : options.font === 'mono' ? this.mono : this.regular
    const [line] = this.wrap(value, font, size, width)
    this.page.drawText(this.clip(line ?? '', font, size, width), { x, y: options.baseline, size, font, color: options.color ?? INK })
  }

  rule(): void {
    this.need(8)
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: A4.width - MARGIN, y: this.y }, thickness: 0.6, color: RULE })
    this.y -= 8
  }

  heading(value: string): void {
    this.need(24)
    this.y -= 6
    this.page.drawText(value.toUpperCase(), { x: MARGIN, y: this.y - 9, size: 8.5, font: this.bold, color: ACCENT })
    this.y -= 14
    this.rule()
  }

  private wrap(value: string, font: PDFFont, size: number, maxWidth: number): string[] {
    const clean = value.replace(/\r/g, '').split('\n')
    const out: string[] = []
    for (const paragraph of clean) {
      let line = ''
      for (const piece of paragraph.split(/\s+/)) {
        const candidate = line ? `${line} ${piece}` : piece
        if (this.widthOf(candidate, font, size) > maxWidth && line) {
          out.push(line)
          line = piece
        } else {
          line = candidate
        }
      }
      out.push(line)
    }
    return out.length > 0 ? out : ['']
  }

  private clip(value: string, font: PDFFont, size: number, maxWidth: number): string {
    if (this.widthOf(value, font, size) <= maxWidth) return value
    let text = value
    while (text.length > 1 && this.widthOf(`${text}…`, font, size) > maxWidth) text = text.slice(0, -1)
    return `${text}…`
  }

  private widthOf(value: string, font: PDFFont, size: number): number {
    try {
      return font.widthOfTextAtSize(value, size)
    } catch {
      // A character the standard font cannot measure (an Arabic name, an
      // emoji): fall back to an estimate rather than failing the document.
      return value.length * size * 0.55
    }
  }

  /** Standard fonts are Latin-1 only; anything else would throw on draw. */
  static safe(value: string): string {
    return value.replace(/[^\u0020-\u00ff]/g, '?')
  }
}

function pairs(sheet: Sheet, entries: Array<[string, string]>): void {
  const columnWidth = sheet.width / 2
  for (let index = 0; index < entries.length; index += 2) {
    sheet.need(24)
    const baseline = sheet.cursor - 9
    const row = entries.slice(index, index + 2)
    row.forEach(([label, value], column) => {
      const x = MARGIN + column * columnWidth
      sheet.cell(label.toUpperCase(), x, columnWidth - 12, { size: 6.8, color: MUTED, baseline: baseline + 10 })
      sheet.cell(value, x, columnWidth - 12, { size: 9.5, font: 'bold', baseline })
    })
    sheet.down(26)
  }
}

/** The whole document, as PDF bytes. */
export async function renderDocumentPdf(document: FrozenDocument, options: PdfOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const mono = await doc.embedFont(StandardFonts.Courier)

  const title = documentTitle(document.kind)
  doc.setTitle(`${title} · ${document.bookingNumber ?? ''}`.trim())
  doc.setProducer(options.applicationName)
  doc.setCreator(options.applicationName)
  doc.setCreationDate(options.generatedAt)

  const sheet = new Sheet(doc, regular, bold, mono)
  const t = (value: string) => Sheet.safe(value)

  // --- masthead
  sheet.text(t(options.organisation), { size: 9, color: MUTED })
  sheet.text(t(title), { size: 18, font: 'bold' })
  sheet.text(t(`${document.bookingNumber ?? 'No booking number'} · ${document.kit.code ?? 'no kit'}${document.kit.name ? ` · ${document.kit.name}` : ''}`), { size: 10, color: MUTED })
  sheet.down(6)
  sheet.rule()

  // --- who and when
  sheet.heading('Booking')
  const editorLine = [document.editor.name ?? '—', document.editor.type ? `(${document.editor.type.toLowerCase()})` : null].filter(Boolean).join(' ')
  pairs(sheet, [
    ['Editor', t(editorLine)],
    ['Mobile', t(document.editor.contactNumber ?? '—')],
    ['Staff ID', t(document.editor.staffId ?? '—')],
    ...(document.editor.type ? [[document.editor.type === 'EXTERNAL' ? 'Company' : 'Department', t(document.editor.company ?? document.editor.department ?? '—')] as [string, string]] : []),
    ...(document.editor.projectName ? [['Project', t(document.editor.projectName)] as [string, string]] : []),
    ...(document.editor.workOrder ? [['Work order', t(document.editor.workOrder)] as [string, string]] : []),
    ...(document.engineer.preparedBy ? [['Prepared by', t(document.engineer.preparedBy)] as [string, string]] : []),
    ...(document.engineer.assigned ? [['Assigned engineer', t(document.engineer.assigned)] as [string, string]] : []),
    [document.kind === 'handover' ? 'Handed over by' : 'Return received by', t((document.kind === 'handover' ? document.engineer.handedOverBy : document.engineer.returnReceivedBy) ?? '—')],
    ['Collected', t(when(document.collectedAt, options.timeZone))],
    ['Expected return', t(when(document.expectedReturnDate, options.timeZone))],
  ])

  if (document.kind === 'return') {
    const late = document.punctuality === 'late'
    pairs(sheet, [
      ['Actual return', t(when(document.returnedAt, options.timeZone))],
      ...(document.returnedBy ? [['Returned by', t(document.returnedBy)] as [string, string]] : []),
      ['Punctuality', t(document.punctuality ? (late ? `Late by ${document.minutesLate ?? 0} minutes` : document.punctuality.replace('-', ' ')) : '—')],
    ])
    if (document.measuredAgainst) {
      sheet.text(t(`Checked against the handover completed ${when(document.measuredAgainst.completedAt, options.timeZone)} (${document.measuredAgainst.lineCount ?? 0} items).`), {
        size: 8.5,
        color: MUTED,
      })
      sheet.down(4)
    }
  }

  if (document.purpose) {
    sheet.text(t(`Purpose: ${document.purpose}`), { size: 9, color: MUTED })
    sheet.down(4)
  }

  // --- equipment
  sheet.heading(document.kind === 'handover' ? `Equipment handed over (${document.equipment.length})` : `Equipment accounted for (${document.equipment.length})`)
  const columns =
    document.kind === 'handover'
      ? [
          { label: 'Code', width: 62 },
          { label: 'Item', width: 150 },
          { label: 'Make and model', width: 108 },
          { label: 'Serial', width: 96 },
          { label: 'Condition', width: 91 },
        ]
      : [
          { label: 'Code', width: 62 },
          { label: 'Item', width: 150 },
          { label: 'Serial', width: 96 },
          { label: 'Went out', width: 84 },
          { label: 'Came back', width: 115 },
        ]

  const header = () => {
    sheet.need(16)
    let x = MARGIN
    const baseline = sheet.cursor - 8
    for (const column of columns) {
      sheet.cell(column.label.toUpperCase(), x, column.width - 6, { size: 6.8, color: MUTED, baseline })
      x += column.width
    }
    sheet.down(12)
    sheet.rule()
  }
  header()

  for (const line of document.equipment) {
    sheet.need(20)
    const baseline = sheet.cursor - 9
    const problem = document.kind === 'return' ? line.returnStatus === 'MISSING' || line.returnStatus === 'DAMAGED' : line.status === 'MISSING' || line.status === 'DAMAGED'
    const values =
      document.kind === 'handover'
        ? [line.assetCode ?? '—', line.name ?? '—', [line.manufacturer, line.model].filter(Boolean).join(' ') || '—', line.serialNumber ?? '—', word(line.status)]
        : [line.assetCode ?? '—', line.name ?? '—', line.serialNumber ?? '—', word(line.handoverStatus), returnWord(line.returnStatus)]

    let x = MARGIN
    values.forEach((value, index) => {
      const isCode = index === 0 || (document.kind === 'handover' ? index === 3 : index === 2)
      const isLast = index === values.length - 1
      sheet.cell(t(value), x, columns[index].width - 6, {
        size: 8.5,
        font: index === 0 ? 'mono' : isCode ? 'mono' : 'regular',
        color: isLast && problem ? WARN : INK,
        baseline,
      })
      x += columns[index].width
    })
    sheet.down(13)

    const accessories = line.accessories.filter((accessory) => accessory.handedOver !== false || accessory.status !== 'NOT_APPLICABLE')
    for (const accessory of accessories) {
      sheet.need(13)
      const accessoryBaseline = sheet.cursor - 8
      const label = [accessory.label ?? accessory.type ?? 'accessory', accessory.expected && accessory.expected > 1 ? `×${accessory.expected}` : null].filter(Boolean).join(' ')
      sheet.cell(t(`— ${label}`), MARGIN + 62, 300, { size: 7.8, color: MUTED, baseline: accessoryBaseline })
      const accessoryProblem = accessory.status === 'MISSING' || accessory.status === 'DAMAGED'
      sheet.cell(t(document.kind === 'return' ? returnWord(accessory.status) : word(accessory.status)), MARGIN + 380, 120, {
        size: 7.8,
        color: accessoryProblem ? WARN : MUTED,
        baseline: accessoryBaseline,
      })
      sheet.down(10)
    }

    if (line.notes) {
      sheet.text(t(`Note: ${line.notes}`), { size: 7.8, color: MUTED, x: MARGIN + 62, maxWidth: sheet.width - 62 })
    }
  }

  // --- checks and software
  if (document.checklist.length > 0) {
    sheet.heading(`Checks (${document.checklist.filter((check) => check.status === 'PASS').length} of ${document.checklist.length} passed)`)
    for (const check of document.checklist) {
      sheet.need(13)
      const baseline = sheet.cursor - 8
      sheet.cell(t(check.label ?? '—'), MARGIN, 380, { size: 8.5, baseline })
      sheet.cell(t(word(check.status, 'not answered')), MARGIN + 390, 120, { size: 8.5, color: check.status === 'FAIL' ? WARN : MUTED, baseline })
      sheet.down(12)
      if (check.notes) sheet.text(t(`Note: ${check.notes}`), { size: 7.8, color: MUTED, x: MARGIN + 12, maxWidth: sheet.width - 12 })
    }
  }

  if (document.software.length > 0) {
    sheet.heading(`Software (${document.software.length})`)
    for (const entry of document.software) {
      sheet.need(13)
      const baseline = sheet.cursor - 8
      sheet.cell(t([entry.name, entry.version].filter(Boolean).join(' ') || '—'), MARGIN, 300, { size: 8.5, baseline })
      sheet.cell(t(entry.installedVersion ?? ''), MARGIN + 310, 90, { size: 8.5, font: 'mono', color: MUTED, baseline })
      sheet.cell(t(word(entry.status)), MARGIN + 410, 100, { size: 8.5, color: entry.status === 'INSTALLED' ? MUTED : WARN, baseline })
      sheet.down(12)
    }
  }

  // --- notes
  if (document.generalNotes) {
    sheet.heading(document.kind === 'handover' ? 'Notes at handover' : 'Return notes')
    sheet.text(t(document.generalNotes), { size: 9 })
  }

  const caseCondition = document.kit.suitcaseStatus
  if (caseCondition) {
    sheet.down(4)
    sheet.text(t(`Case condition: ${word(caseCondition)}`), { size: 8.5, color: MUTED })
  }

  // --- signatures
  sheet.heading('Signatures')
  const boxWidth = (sheet.width - 16) / 2
  const embedded = new Map<string, PDFImage>()
  for (const signature of options.signatures) {
    try {
      embedded.set(signature.type, signature.mimeType === 'image/png' ? await doc.embedPng(signature.bytes) : await doc.embedJpg(signature.bytes))
    } catch {
      // An unreadable image must not cost the document its other signature.
    }
  }

  sheet.need(120)
  const top = sheet.cursor
  document.signatures.slice(0, 2).forEach((signature, index) => {
    const x = MARGIN + index * (boxWidth + 16)
    const page = sheet.current
    page.drawRectangle({ x, y: top - 96, width: boxWidth, height: 92, borderColor: RULE, borderWidth: 0.6 })
    const image = embedded.get(signature.type)
    if (image) {
      const scale = Math.min((boxWidth - 24) / image.width, 46 / image.height)
      page.drawImage(image, { x: x + 12, y: top - 62, width: image.width * scale, height: image.height * scale })
    } else {
      page.drawText('(signature on file)', { x: x + 12, y: top - 46, size: 7.5, font: regular, color: MUTED })
    }
    page.drawLine({ start: { x: x + 12, y: top - 68 }, end: { x: x + boxWidth - 12, y: top - 68 }, thickness: 0.6, color: RULE })
    page.drawText(Sheet.safe(signature.signerMobile ? `${signature.signerName ?? '—'} · ${signature.signerMobile}` : (signature.signerName ?? '—')), { x: x + 12, y: top - 80, size: 8.5, font: bold, color: INK })
    page.drawText(Sheet.safe(`${signature.type.replace(/_/g, ' ').toLowerCase()} · ${when(signature.signedAt, options.timeZone)}`), {
      x: x + 12,
      y: top - 91,
      size: 7,
      font: regular,
      color: MUTED,
    })
  })
  sheet.down(104)

  // --- footer on every page
  const stamp = `${options.applicationName} · ${title} · ${document.bookingNumber ?? ''} · generated ${formatDateTime(options.generatedAt, options.timeZone)}`
  sheet.pages.forEach((page, index) => {
    page.drawText(Sheet.safe(stamp), { x: MARGIN, y: 24, size: 6.8, font: regular, color: MUTED })
    page.drawText(`${index + 1} / ${sheet.pages.length}`, { x: A4.width - MARGIN - 30, y: 24, size: 6.8, font: regular, color: MUTED })
  })

  return doc.save()
}
