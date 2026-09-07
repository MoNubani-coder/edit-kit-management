'use client'

import { Printer } from 'lucide-react'

import { Button } from '@/components/ui/button'

/** Opens the browser's own print dialogue for the label card. */
export function PrintButton() {
  return (
    <Button type="button" onClick={() => window.print()}>
      <Printer aria-hidden className="h-4 w-4" />
      Print label
    </Button>
  )
}
