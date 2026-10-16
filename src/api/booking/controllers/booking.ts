/**
 * booking controller
 *
 * Public (anonymous guests):  create, verifyPayment, verifyPaymentImage, availability
 * Authenticated (logged in):   find / findOne (own bookings only), update (cancel own)
 */

import { factories } from '@strapi/strapi';

// Fields a guest must never be able to set from the public site
const PROTECTED_FIELDS = [
  'booking_status',
  'payment_status',
  'verify_request_id',
  'verified_at',
];

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB

function stripProtected(ctx: any) {
  const data = ctx.request.body?.data;
  if (data && typeof data === 'object') {
    for (const f of PROTECTED_FIELDS) delete data[f];
  }
}

const sameEmail = (a: unknown, b: unknown) =>
  String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

// A booking blocks its dates when it is Approved, or Pending with a payment
// that has not failed. Cancelled, Rejected and failed-payment bookings free
// the dates again.
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

/**
 * Detect the real image mime from a buffer's magic bytes.
 */
function sniffImageMime(buf: Buffer): string | null {
  if (!buf || buf.length < 4) return null;

  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return 'image/png';
  }
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return 'image/gif';
  }
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf.length >= 12 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

export default factories.createCoreController(
  'api::booking.booking',
  ({ strapi }) => ({
    // ─── Guests create a booking ─────────────────────────────
    async create(ctx) {
      stripProtected(ctx);
      const data = ctx.request.body?.data ?? {};

      const ref =
        data.room?.documentId ??
        data.room?.connect?.[0]?.documentId ??
        data.room;

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
      if (!room || room.available === false)
        return ctx.badRequest('Room not available');

      const nights = Math.round(
        (new Date(data.check_out).getTime() -
          new Date(data.check_in).getTime()) /
          86400000
      );
      if (!(nights >= 1)) return ctx.badRequest('Invalid dates');

      const clash: any[] = await strapi
        .documents('api::booking.booking')
        .findMany({
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
        return ctx.badRequest(
          'These dates are no longer available for this room.'
        );
      }

      data.total = Math.ceil(Number(room.price) * nights);
      ctx.request.body.data = data;

      return super.create(ctx);
    },

    // ─── Anyone: which dates are taken ───
    async availability(ctx) {
      const roomId = ctx.query?.room ? String(ctx.query.room) : null;
      const today = new Date().toISOString().slice(0, 10);

      const and: any[] = [
        blockingFilter(),
        { check_out: { $gte: today } },
      ];
      if (roomId) and.push({ room: { documentId: roomId } });

      const rows: any[] = await strapi
        .documents('api::booking.booking')
        .findMany({
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

    // ─── Logged-in users: list ONLY their own bookings ───
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

    // ─── Logged-in users: open ONLY their own booking ───
    async findOne(ctx) {
      const user = ctx.state.user;
      if (!user?.email) return ctx.unauthorized('Please log in.');

      const res: any = await super.findOne(ctx);
      if (!res?.data || !sameEmail(res.data.email, user.email)) {
        return ctx.notFound('Booking not found');
      }
      return res;
    },

    // ─── Logged-in users: cancel only ───
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

      await docs.update({
        documentId,
        data: { booking_status: 'Cancelled' },
      } as any);
      await docs.publish({ documentId } as any);
      const updated: any = await docs.findOne({ documentId });

      ctx.body = { data: updated };
    },

    // ─── Guests verify their payment (text reference) ───
    async verifyPayment(ctx) {
      const { documentId } = ctx.params;
      const docs = strapi.documents('api::booking.booking');
      const booking: any = await docs.findOne({ documentId });
      if (!booking) return ctx.notFound('Booking not found');

      if (booking.payment_status !== 'verified') {
        const { payment_bank, payment_reference } = ctx.request.body ?? {};
        if (payment_bank !== undefined || payment_reference !== undefined) {
          const bankCode = String(payment_bank ?? '').trim().toLowerCase();
          const reference = String(payment_reference ?? '').trim();

          if (!bankCode) return ctx.badRequest('Bank is required');
          if (reference.length < 4 || reference.length > 300) {
            return ctx.badRequest('Invalid reference number');
          }

          await docs.update({
            documentId,
            data: { payment_bank: bankCode, payment_reference: reference },
          } as any);
          await docs.publish({ documentId } as any);
        }
      }

      const result = await strapi
        .service('api::booking.booking')
        .verifyPayment(documentId);

      if (result.code === 'not_found')
        return ctx.notFound('Booking not found');
      if (result.code === 'bad_request')
        return ctx.badRequest(result.message);

      ctx.body = { status: result.status, message: result.message };
    },

    // ─── Guests verify with a receipt image ───
    async verifyPaymentImage(ctx) {
      const { documentId } = ctx.params;
      const docs = strapi.documents('api::booking.booking');
      const booking: any = await docs.findOne({ documentId });
      if (!booking) return ctx.notFound('Booking not found');

      const files = (ctx.request as any)?.files ?? {};

      strapi.log.info(
        `[verifyPaymentImage] ctx.request.files keys = ${
          Object.keys(files).join(', ') || '(none)'
        }`
      );

      const fileField =
        files['image'] ||
        files['files.image'] ||
        files['files'] ||
        Object.values(files)[0];

      const file: any = Array.isArray(fileField) ? fileField[0] : fileField;

      if (!file) {
        strapi.log.warn(
          `[verifyPaymentImage] no file found in request. files=${JSON.stringify(
            Object.keys(files)
          )}`
        );
        return ctx.badRequest(
          'No image uploaded. Please attach a JPG, PNG, GIF, or WebP.'
        );
      }

      strapi.log.info(
        `[verifyPaymentImage] RAW file: ` +
          `keys=[${Object.keys(file).join(',')}] ` +
          `hasBuffer=${!!file.buffer} isBuffer=${Buffer.isBuffer(file.buffer)} ` +
          `hasFilepath=${!!file.filepath} filepath=${file.filepath || 'none'} ` +
          `mimetype=${file.mimetype || file.mime || 'none'} ` +
          `originalFilename=${
            file.originalFilename || file.originalname || file.name || 'none'
          } ` +
          `size=${file.size || (file.buffer ? file.buffer.length : 'none')}`
      );

      // ── Resolve the file contents ──
      // Strapi/multer uses:
      //   - file.buffer    when memory storage is configured
      //   - file.filepath  when disk storage is used (Strapi 5 default)
      let buffer: Buffer | null = null;
      if (file.buffer && Buffer.isBuffer(file.buffer)) {
        buffer = file.buffer;
      } else if (file.filepath || file.path) {
        const diskPath = file.filepath || file.path;
        try {
          const fs = await import('fs/promises');
          buffer = await fs.readFile(diskPath);
        } catch (e) {
          strapi.log.error(
            `Could not read uploaded file at ${diskPath}: ${e}`
          );
          buffer = null;
        }
      }

      if (!buffer || buffer.length === 0) {
        strapi.log.warn(
          `[verifyPaymentImage] could not resolve buffer. hasBuffer=${!!file.buffer} hasFilepath=${!!file.filepath}`
        );
        return ctx.badRequest(
          'We could not read the uploaded image. Please try again.'
        );
      }

      const size = buffer.length;
      if (size > MAX_IMAGE_BYTES) {
        return ctx.badRequest('Image is too large. Max 8 MB.');
      }

      const sniffedMime = sniffImageMime(buffer);
      const reportedMime = String(
        file.mimetype || file.mime || file.type || ''
      ).toLowerCase();

      strapi.log.info(
        `[verifyPaymentImage] resolved: reportedMime="${reportedMime}" sniffedMime="${sniffedMime}" size=${size}`
      );

      if (!sniffedMime) {
        return ctx.badRequest(
          'Please upload a JPG, PNG, GIF, or WebP image.'
        );
      }

      const safeExt =
        sniffedMime === 'image/jpeg'
          ? 'jpg'
          : sniffedMime === 'image/png'
          ? 'png'
          : sniffedMime === 'image/gif'
          ? 'gif'
          : 'webp';
      const safeName = `receipt.${safeExt}`;

      const bankFromBody =
        ctx.request.body?.payment_bank ?? ctx.request.body?.bank ?? null;
      const bankCode = String(bankFromBody || booking.payment_bank || '')
        .trim()
        .toLowerCase();

      const result = await strapi
        .service('api::booking.booking')
        .verifyPaymentImage(
          documentId,
          { buffer, mime: sniffedMime, name: safeName },
          bankCode
        );

      if (result.code === 'not_found')
        return ctx.notFound('Booking not found');
      if (result.code === 'bad_request')
        return ctx.badRequest(result.message);

      ctx.body = { status: result.status, message: result.message };
    },
  })
);