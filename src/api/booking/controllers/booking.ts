/**
 * booking controller
 */

import { factories } from '@strapi/strapi';

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

export default factories.createCoreController('api::booking.booking', ({ strapi }) => ({
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

    // Never trust the total sent by the browser
    data.total = Math.ceil(Number(room.price) * nights);
    ctx.request.body.data = data;

    return super.create(ctx);
  },

  async update(ctx) {
    stripProtected(ctx);
    const data = ctx.request.body?.data;
    if (data && typeof data === 'object') {
      delete data.total;
      delete data.room;
      delete data.check_in;
      delete data.check_out;
    }
    return super.update(ctx);
  },

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