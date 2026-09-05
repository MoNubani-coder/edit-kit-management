'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'

import { cancelBookingSchema, createBookingSchema, formDataToObject, updateBookingSchema } from '@/lib/validation/bookings'
import { action, type ActionResult } from '@/server/auth/action'
import { prisma } from '@/server/db/prisma'
import {
  cancelBooking,
  createBooking,
  markReadyForHandover,
  reserveBooking,
  returnToDraft,
  revertReadyForHandover,
  updateBooking,
} from '@/server/services/bookings.service'

/**
 * Booking mutations. Each is built with `action()` - permission, Zod
 * validation and safe failure are not optional. Lifecycle changes are
 * explicit operations, never a status field posted from a form.
 */

export type BookingFormState = ActionResult<void> | null

const id = z.object({ id: z.string().min(1) })

const createBookingAction = action({
  permission: 'booking.create',
  schema: createBookingSchema,
  async handler({ actor, input }) {
    const created = await createBooking(prisma, actor, input)
    redirect(`/bookings/${created.id}`)
  },
})

export async function createBookingFormAction(_previous: BookingFormState, formData: FormData): Promise<BookingFormState> {
  return createBookingAction(formDataToObject(formData))
}

const updateBookingAction = action({
  permission: 'booking.update',
  schema: updateBookingSchema.extend(id.shape),
  async handler({ actor, input }) {
    const { id, ...rest } = input
    await updateBooking(prisma, actor, id, rest)
    redirect(`/bookings/${id}`)
  },
})

export async function updateBookingFormAction(_previous: BookingFormState, formData: FormData): Promise<BookingFormState> {
  return updateBookingAction(formDataToObject(formData))
}

const reserveBookingAction = action({
  permission: 'booking.update',
  schema: id,
  async handler({ actor, input }) {
    await reserveBooking(prisma, actor, input.id)
    redirect(`/bookings/${input.id}`)
  },
})

export async function reserveBookingFormAction(_previous: BookingFormState, formData: FormData): Promise<BookingFormState> {
  return reserveBookingAction(formDataToObject(formData))
}

const returnToDraftAction = action({
  permission: 'booking.update',
  schema: id,
  async handler({ actor, input }) {
    await returnToDraft(prisma, actor, input.id)
    redirect(`/bookings/${input.id}`)
  },
})

export async function returnToDraftFormAction(_previous: BookingFormState, formData: FormData): Promise<BookingFormState> {
  return returnToDraftAction(formDataToObject(formData))
}

const markReadyAction = action({
  permission: 'booking.update',
  schema: id,
  async handler({ actor, input }) {
    await markReadyForHandover(prisma, actor, input.id)
    redirect(`/bookings/${input.id}`)
  },
})

export async function markReadyFormAction(_previous: BookingFormState, formData: FormData): Promise<BookingFormState> {
  return markReadyAction(formDataToObject(formData))
}

const revertReadyAction = action({
  permission: 'booking.update',
  schema: id,
  async handler({ actor, input }) {
    await revertReadyForHandover(prisma, actor, input.id)
    redirect(`/bookings/${input.id}`)
  },
})

export async function revertReadyFormAction(_previous: BookingFormState, formData: FormData): Promise<BookingFormState> {
  return revertReadyAction(formDataToObject(formData))
}

const cancelBookingAction = action({
  permission: 'booking.cancel',
  schema: cancelBookingSchema.extend(id.shape),
  async handler({ actor, input }) {
    const { id, ...rest } = input
    await cancelBooking(prisma, actor, id, rest)
    redirect(`/bookings/${id}`)
  },
})

export async function cancelBookingFormAction(_previous: BookingFormState, formData: FormData): Promise<BookingFormState> {
  return cancelBookingAction(formDataToObject(formData))
}
