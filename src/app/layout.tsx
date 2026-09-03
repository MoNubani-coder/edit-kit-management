import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'

import './globals.css'

// Inter reads well in dense enterprise tables at small sizes, which is most of
// what this application is.
const inter = Inter({
  variable: '--font-sans',
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

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="bg-slate-50 text-slate-900 min-h-full flex flex-col font-sans">
        {children}
      </body>
    </html>
  )
}
