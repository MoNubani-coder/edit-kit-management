import 'server-only'

import { headers } from 'next/headers'
import QRCode from 'qrcode'

/**
 * Kit QR codes: one per kit, printed on the physical case.
 *
 * The payload is a short, stable application URL - `<origin>/k/<kit id>` - and
 * nothing else. No editor, no booking, no barcode, no status: a label on a
 * flight case is readable by anyone who can see the case, so the code carries
 * only an opaque identifier that is useless without a login. Scanning with the
 * device's own camera opens the URL; `/k/<id>` then requires a session and
 * `kit.read` before redirecting to the kit, so an unauthenticated scan lands
 * on the login page and comes back afterwards.
 *
 * The kit id (a cuid) is used rather than the kit code so a relabelled or
 * renamed kit keeps its sticker, and so the payload says nothing about the
 * inventory numbering.
 */

/** The path a scan resolves through. Kept short so the QR stays low-density. */
export function kitScanPath(kitId: string): string {
  return `/k/${kitId}`
}

/**
 * The absolute URL to encode. Derived from the request the page is rendering
 * for, so the same deployment works on localhost, a LAN address or a domain
 * without another environment variable to keep in step.
 */
export async function scanOrigin(): Promise<string> {
  const requestHeaders = await headers()
  const forwardedHost = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host')
  const protocol = requestHeaders.get('x-forwarded-proto') ?? (forwardedHost?.startsWith('localhost') ? 'http' : 'https')
  return forwardedHost ? `${protocol}://${forwardedHost}` : ''
}

export async function kitScanUrl(kitId: string): Promise<string> {
  return `${await scanOrigin()}${kitScanPath(kitId)}`
}

/**
 * The QR as an inline SVG string, so nothing is fetched at render time and the
 * printable page needs no client JavaScript. Error correction level M survives
 * a scuffed sticker; the quiet zone is kept small because the label adds its
 * own margin.
 */
export async function qrSvg(payload: string, options: { scale?: number } = {}): Promise<string> {
  return QRCode.toString(payload, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: options.scale ?? 240,
    color: { dark: '#0f1b33', light: '#ffffff' },
  })
}

export interface KitQrCode {
  /** The URL encoded in the code, shown under it so it can also be typed. */
  url: string
  svg: string
}

export async function kitQrCode(kitId: string, options: { scale?: number } = {}): Promise<KitQrCode> {
  const url = await kitScanUrl(kitId)
  return { url, svg: await qrSvg(url, options) }
}
