import type { Metadata, Viewport } from 'next'
import { Inter, Manrope } from 'next/font/google'
import { headers } from 'next/headers'
import type { ReactNode } from 'react'

import { ThemeProvider } from '@/components/theme/theme-provider'

import './globals.css'

// Inter reads well in dense enterprise tables at small sizes, which is most of
// what this application is. Manrope carries headings, the brand and headline
// numbers, giving the product its own voice without hurting legibility.
const inter = Inter({
  variable: '--font-sans',
  subsets: ['latin'],
  display: 'swap',
})

const manrope = Manrope({
  variable: '--font-display',
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'Edit Kit Management System',
    template: '%s | Edit Kit Management System',
  },
  description:
    'Internal system for booking, handing over and returning external editing kits.',
  // This is an internal tool. Keep it out of any index it might reach.
  robots: { index: false, follow: false, nocache: true },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Engineers use this on tablets during handover; pinch-zoom on a dense
  // equipment table is a legitimate need, so it is not disabled.
  maximumScale: 5,
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The CSP nonce minted by proxy.ts; next-themes attaches it to its anti-flash script.
  const nonce = (await headers()).get('x-nonce') ?? undefined

  return (
    // suppressHydrationWarning: next-themes sets the theme class on <html>
    // before React hydrates, which is exactly the mismatch we want.
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${manrope.variable} h-full antialiased`}>
      <body className="theme-transition flex min-h-full flex-col bg-background font-sans text-foreground">
        <ThemeProvider nonce={nonce}>{children}</ThemeProvider>
      </body>
    </html>
  )
}
