/**
 * booking controller
 *
 * Public (anonymous guests):  create, verifyPayment, availability (dates only, no personal data)
 * Authenticated (logged in):   find / findOne (own bookings only), update (cancel own booking only)
 */

import { factories } from '@strapi/strapi';

// Fields a guest must never be able to set from the public site
const PROTECTED_FIELDS = [
  'booking_status',
  'payment_status',
  'verify_request_id',
  'verified_at',
];
const ALLOWED_BANKS = ['cbe', 'telebirr'];

function stripProtected(ctx: any) {
  const data = ctx.request.body?.data;
  if (data && typeof data === 'object') {
    for (const f of PROTECTED_FIELDS) delete data[f];
  }
}

const sameEmail = (a: unknown, b: unknown) =>
  String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

// A booking blocks its dates when it is Approved, or Pending with a payment that has not failed.
// Cancelled, Rejected and failed-payment bookings free the dates again.
const blockingFilter = () => ({
  $or: [
    { booking_status: 'Approved' },
    {
      $and: [
        { booking_status: 'Pending' },
        {
          $or: [
            { payment_status: { $null: true } },
            { payment_status: { $ne: 'failed' } },
          ],
        },
      ],
    },
  ],
});

export default factories.createCoreController('api::booking.booking', ({ strapi }) => ({
  // ─── Guests create a booking (no login needed) ──────────────────
  async create(ctx) {
    stripProtected(ctx);
    const data = ctx.request.body?.data ?? {};

    // Work out which room was requested (documentId, numeric id, or connect form)
    const ref =
      data.room?.documentId ?? data.room?.connect?.[0]?.documentId ?? data.room;
    let roomDocId: string | null = null;
    if (ref !== undefined && ref !== null && ref !== '') {
      if (typeof ref === 'number' || /^\d+$/.test(String(ref))) {
        const row: any = await strapi.db
          .query('api::room.room')
          .findOne({ where: { id: Number(ref) } });
        roomDocId = row?.documentId ?? null;
      } else {
        roomDocId = String(ref);
      }
    }
    if (!roomDocId) return ctx.badRequest('Room is required');

    const room: any = await strapi
      .documents('api::room.room')
      .findOne({ documentId: roomDocId, status: 'published' });
    if (!room || room.available === false) return ctx.badRequest('Room not available');

    const nights = Math.round(
      (new Date(data.check_out).getTime() - new Date(data.check_in).getTime()) / 86400000
    );
    if (!(nights >= 1)) return ctx.badRequest('Invalid dates');

    // Reject dates that overlap an existing booking for the same room
    const clash: any[] = await strapi.documents('api::booking.booking').findMany({
      status: 'published',
      filters: {
        $and: [
          blockingFilter(),
          { room: { documentId: roomDocId } },
          { check_in: { $lt: data.check_out } },
          { check_out: { $gt: data.check_in } },
        ],
      },
      limit: 1,
    } as any);
    if (clash.length) {
      return ctx.badRequest('These dates are no longer available for this room.');
    }

    // Never trust the total sent by the browser
    data.total = Math.ceil(Number(room.price) * nights);
    ctx.request.body.data = data;

    return super.create(ctx);
  },

  // ─── Anyone: which dates are taken (no names, emails or phones) ─
  async availability(ctx) {
    const roomId = ctx.query?.room ? String(ctx.query.room) : null;
    const today = new Date().toISOString().slice(0, 10);

    const and: any[] = [blockingFilter(), { check_out: { $gte: today } }];
    if (roomId) and.push({ room: { documentId: roomId } });

    const rows: any[] = await strapi.documents('api::booking.booking').findMany({
      status: 'published',
      filters: { $and: and },
      fields: ['check_in', 'check_out', 'booking_status'],
      populate: { room: { fields: ['documentId'] } },
      limit: 500,
    } as any);

    ctx.body = {
      data: rows.map((r) => ({
        check_in: r.check_in,
        check_out: r.check_out,
        booking_status: r.booking_status,
        room: r.room ? { documentId: r.room.documentId } : null,
      })),
    };
  },

  // ─── Logged-in users: list ONLY their own bookings ──────────────
  async find(ctx) {
    const user = ctx.state.user;
    if (!user?.email) return ctx.unauthorized('Please log in.');

    const query: any = ctx.query ?? {};
    ctx.query = {
      ...query,
      filters: { ...(query.filters ?? {}), email: { $eqi: user.email } },
    };
    return super.find(ctx);
  },

  // ─── Logged-in users: open ONLY their own booking ───────────────
  async findOne(ctx) {
    const user = ctx.state.user;
    if (!user?.email) return ctx.unauthorized('Please log in.');

    const res: any = await super.findOne(ctx);
    if (!res?.data || !sameEmail(res.data.email, user.email)) {
      return ctx.notFound('Booking not found');
    }
    return res;
  },

  // ─── Logged-in users: the only allowed change is cancelling ─────
  async update(ctx) {
    const user = ctx.state.user;
    if (!user?.email) return ctx.unauthorized('Please log in.');

    const { id: documentId } = ctx.params;
    const docs = strapi.documents('api::booking.booking');
    const booking: any = await docs.findOne({ documentId });

    if (!booking || !sameEmail(booking.email, user.email)) {
      return ctx.notFound('Booking not found');
    }
    if (ctx.request.body?.data?.booking_status !== 'Cancelled') {
      return ctx.forbidden('Bookings can only be cancelled.');
    }
    if (!['Pending', 'Approved'].includes(booking.booking_status)) {
      return ctx.badRequest('This booking can no longer be cancelled.');
    }

    await docs.update({ documentId, data: { booking_status: 'Cancelled' } } as any);
    await docs.publish({ documentId } as any);
    const updated: any = await docs.findOne({ documentId });

    ctx.body = { data: updated };
  },

  // ─── Guests verify their payment (no login needed) ──────────────
  async verifyPayment(ctx) {
    const { documentId } = ctx.params;
    const docs = strapi.documents('api::booking.booking');
    const booking: any = await docs.findOne({ documentId });
    if (!booking) return ctx.notFound('Booking not found');

    // Save the bank + reference the guest typed (only while not yet verified)
    if (booking.payment_status !== 'verified') {
      const { payment_bank, payment_reference } = ctx.request.body ?? {};
      if (payment_bank !== undefined || payment_reference !== undefined) {
        if (!ALLOWED_BANKS.includes(payment_bank)) return ctx.badRequest('Unsupported bank');
        const reference = String(payment_reference ?? '').trim();
        if (reference.length < 6 || reference.length > 300) {
          return ctx.badRequest('Invalid reference number');
        }
        await docs.update({
          documentId,
          data: { payment_bank, payment_reference: reference },
        } as any);
      }
    }

    const result = await strapi.service('api::booking.booking').verifyPayment(documentId);

    if (result.code === 'not_found') return ctx.notFound('Booking not found');
    if (result.code === 'bad_request') return ctx.badRequest(result.message);

    ctx.body = { status: result.status, message: result.message };
  },
}));