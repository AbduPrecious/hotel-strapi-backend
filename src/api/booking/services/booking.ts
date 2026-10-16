/**
 * booking service
 *
 * Handles payment verification via Verify.ET for any bank configured
 * in the payment-method single type's `banks` repeatable component.
 *
 * Two entry points:
 *   - verifyPayment(documentId)                 → text reference verification
 *   - verifyPaymentImage(documentId, file, bank) → image (receipt) verification
 *
 * Both share the same final checks: amount, settlement match, duplicate
 * reference, and auto-approval on success.
 */

import { factories } from '@strapi/strapi';

const BASE = process.env.VERIFY_ET_BASE_URL || 'https://verify.et';
const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 10;
const WAIT_MS_TEXT = 10000; // ask Verify.ET to wait up to 10s for text refs
const WAIT_MS_IMAGE = 10000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function authHeaders(extra: Record<string, string> = {}) {
  return { 'x-api-key': process.env.VERIFY_ET_API_KEY as string, ...extra };
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Read the payment-method single type and find a bank by code. */
async function getBankEntry(strapi: any, bankCode: string) {
  const pm: any = await strapi
    .documents('api::payment-method.payment-method')
    .findFirst({ populate: { banks: { populate: ['logo', 'qr_code'] } } } as any);

  if (!pm || !Array.isArray(pm.banks)) return null;

  const code = String(bankCode || '').trim().toLowerCase();
  const entry = pm.banks.find(
    (b: any) => String(b?.bank_code || '').trim().toLowerCase() === code
  );
  if (!entry) return null;

  const rawAccount = entry.account_number ? String(entry.account_number) : '';
  const settlementAccount = rawAccount.replace(/\D/g, '') || null;

  return {
    bank_code: String(entry.bank_code || '').toLowerCase(),
    display_name: entry.display_name || entry.bank_code || 'Bank',
    settlement_account: settlementAccount,
  };
}

/** Load a booking by documentId. */
async function getBooking(strapi: any, documentId: string) {
  return strapi
    .documents('api::booking.booking')
    .findOne({ documentId } as any);
}

/** Persist updates on a booking and re-publish. */
async function saveBooking(strapi: any, documentId: string, data: any) {
  const docs = strapi.documents('api::booking.booking');
  await docs.update({ documentId, data } as any);
  await docs.publish({ documentId } as any);
}

/** Same receipt cannot pay for two bookings. */
async function hasDuplicateReference(
  strapi: any,
  documentId: string,
  reference: string
) {
  if (!reference) return false;
  const rows: any[] = await strapi.documents('api::booking.booking').findMany({
    filters: {
      payment_reference: reference.trim(),
      payment_status: 'verified',
      documentId: { $ne: documentId },
    },
    limit: 1,
  } as any);
  return rows.length > 0;
}

/** Poll the status URL until terminal state. */
async function pollStatus(requestId: string) {
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS);
    try {
      const res = await fetch(
        `${BASE}/api/verify/${encodeURIComponent(requestId)}`,
        { headers: authHeaders() }
      );
      const json: any = await res.json().catch(() => ({}));
      const s = json?.data?.processingStatus;
      if (s === 'completed' || s === 'failed') return json;
    } catch (e) {
      // swallow — retry
    }
  }
  return null;
}

/**
 * Shared evaluator for both text and image responses from Verify.ET.
 * Returns { status, message, save } where `save` is the partial data to
 * persist on the booking.
 */
function evaluateVerifyResponse(
  json: any,
  booking: any
): { status: 'verified' | 'failed' | 'pending'; message: string; save: any } {
  const raw: any = Array.isArray(json?.data) ? json.data[0] : json?.data;
  const item: any = raw?.result ?? raw;

  if (!item || item.verified !== true) {
    return {
      status: 'failed',
      message:
        'We could not find this payment. Please check the reference number, or upload your receipt image.',
      save: { payment_status: 'failed' },
    };
  }

  // Amount must be present and cover the booking total
  if (item.amount === undefined || item.amount === null) {
    return {
      status: 'pending',
      message:
        'Payment found, but the amount was not returned. Our staff will confirm it shortly.',
      save: { payment_status: 'verifying' },
    };
  }

  const paidAmount = Number(item.amount);
  const bookingTotal = Number(booking.total);

  if (!Number.isFinite(paidAmount)) {
    return {
      status: 'pending',
      message:
        'Payment found, but the amount could not be read. Our staff will confirm it shortly.',
      save: { payment_status: 'verifying' },
    };
  }

  if (paidAmount < bookingTotal) {
    return {
      status: 'failed',
      message: `The amount paid (ETB ${paidAmount}) is less than the booking total (ETB ${bookingTotal}). Please send the remaining amount or contact the hotel.`,
      save: { payment_status: 'failed' },
    };
  }

  // Overpayment — approve, but log it for staff visibility
  if (paidAmount > bookingTotal * 1.05) {
    strapi.log.warn(
      `[booking ${booking.documentId}] Overpayment: paid ${paidAmount}, expected ${bookingTotal}`
    );
  }

  // Settlement account match (unless explicitly disabled)
  if (process.env.VERIFY_ET_REQUIRE_RECEIVER_MATCH !== 'false') {
    const match = raw?.settlementAccountMatch?.matched;
    if (match !== true) {
      return {
        status: 'failed',
        message:
          'This payment was not sent to the hotel account. Please check you paid the correct account, or contact the hotel.',
        save: { payment_status: 'failed' },
      };
    }
  }

  // All good
  const autoApprove = process.env.VERIFY_ET_AUTO_APPROVE !== 'false';
  return {
    status: 'verified',
    message: 'Payment verified. Your booking is confirmed!',
    save: {
      payment_status: 'verified',
      verified_at: new Date().toISOString(),
      ...(autoApprove ? { booking_status: 'Approved' } : {}),
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────

export default factories.createCoreService(
  'api::booking.booking',
  ({ strapi }) => ({
    /**
     * Text reference verification.
     * Called by POST /api/bookings/:documentId/verify-payment
     */
    async verifyPayment(documentId: string) {
      const booking: any = await getBooking(strapi, documentId);
      if (!booking) return { code: 'not_found' };

      if (booking.payment_status === 'verified') {
        return { status: 'verified', message: 'Payment already verified.' };
      }

      if (booking.payment_method !== 'bank_transfer') {
        return { code: 'bad_request', message: 'This booking is not a bank transfer.' };
      }

      const bankCode = String(booking.payment_bank || '').toLowerCase();
      const reference = String(booking.payment_reference || '').trim();

      if (!bankCode || !reference) {
        return {
          code: 'bad_request',
          message: 'Select a bank and enter the reference number.',
        };
      }

      // Bank must exist in Strapi's payment-method banks[]
      const bankEntry = await getBankEntry(strapi, bankCode);
      if (!bankEntry) {
        return {
          code: 'bad_request',
          message: 'This bank is not configured for online verification.',
        };
      }

      // Duplicate reference guard
      const isDup = await hasDuplicateReference(strapi, documentId, reference);
      if (isDup) {
        await saveBooking(strapi, documentId, { payment_status: 'failed' });
        return {
          status: 'failed',
          message: 'This payment reference was already used for another booking.',
        };
      }

      if (!bankEntry.settlement_account) {
        strapi.log.error(
          `No account number set for bank "${bankCode}" in payment-method.banks[]`
        );
        await saveBooking(strapi, documentId, { payment_status: 'unverified' });
        return {
          status: 'pending',
          message:
            'We could not check your payment automatically. Our staff will confirm it manually.',
        };
      }

      await saveBooking(strapi, documentId, { payment_status: 'verifying' });

      // Build the Verify.ET text payload
      const body: Record<string, any> = {
        bank: bankCode,
        reference,
        settlementAccount: bankEntry.settlement_account,
      };
      if (booking.payment_suffix) {
        if (bankCode === 'cbebirr' || bankCode === 'cbe_birr') {
          body.phoneNumber = booking.payment_suffix;
        } else {
          body.suffix = booking.payment_suffix;
        }
      }

      let res: Response;
      try {
        res = await fetch(`${BASE}/api/verify?waitMs=${WAIT_MS_TEXT}`, {
          method: 'POST',
          headers: authHeaders({
            'Content-Type': 'application/json',
            'Idempotency-Key': `booking-${documentId}-${reference}`,
          }),
          body: JSON.stringify(body),
        });
      } catch (e) {
        strapi.log.error(`Verify.ET unreachable: ${e}`);
        await saveBooking(strapi, documentId, { payment_status: 'unverified' });
        return {
          status: 'pending',
          message:
            'Verification service is unavailable. Please try again shortly, or contact the hotel.',
        };
      }

      let json: any = await res.json().catch(() => ({}));

      if (!res.ok && res.status !== 202) {
        strapi.log.error(
          `Verify.ET error ${res.status}: ${JSON.stringify(json)}`
        );
        // 422 = the request itself is malformed (bad ref format for bank)
        const isFailed = res.status === 422;
        await saveBooking(strapi, documentId, {
          payment_status: isFailed ? 'failed' : 'unverified',
        });
        return {
          status: isFailed ? 'failed' : 'pending',
          message: isFailed
            ? 'That reference does not look valid for this bank. Please check it and try again.'
            : 'We could not check your payment right now. Our staff will confirm it manually.',
        };
      }

      const requestId = json.requestId;
      if (requestId) {
        await saveBooking(strapi, documentId, { verify_request_id: requestId });
      }

      if (res.status === 202) {
        const polled = await pollStatus(requestId);
        if (!polled) {
          await saveBooking(strapi, documentId, { payment_status: 'verifying' });
          return {
            status: 'pending',
            message:
              'Your payment is still being checked. Please wait a moment and try again.',
          };
        }
        json = polled;
      }

      const outcome = evaluateVerifyResponse(json, booking);
      await saveBooking(strapi, documentId, outcome.save);
      return { status: outcome.status, message: outcome.message };
    },

    /**
     * Image (receipt) verification.
     * Called by POST /api/bookings/:documentId/verify-payment-image
     * Expects `file` = { buffer, mime, name } and `bankCode`.
     */
    async verifyPaymentImage(
      documentId: string,
      file: { buffer: Buffer | Uint8Array; mime: string; name: string },
      bankCode: string
    ) {
      const booking: any = await getBooking(strapi, documentId);
      if (!booking) return { code: 'not_found' };

      if (booking.payment_status === 'verified') {
        return { status: 'verified', message: 'Payment already verified.' };
      }

      if (booking.payment_method !== 'bank_transfer') {
        return { code: 'bad_request', message: 'This booking is not a bank transfer.' };
      }

      const code = String(bankCode || booking.payment_bank || '').toLowerCase();
      const bankEntry = code ? await getBankEntry(strapi, code) : null;

      // For image verify we do not require a settlement account locally,
      // but we do pass it if it exists.
      const settlementAccount = bankEntry?.settlement_account || undefined;

      await saveBooking(strapi, documentId, { payment_status: 'verifying' });

      // Build multipart form for Verify.ET
      const form = new FormData();

      // Node 18+ has global FormData + Blob. Use Blob from buffer.
      const blob = new Blob([file.buffer as any], { type: file.mime || 'image/jpeg' });
      form.append('image', blob, file.name || 'receipt.jpg');

      if (code) form.append('bank', code);
      if (settlementAccount) form.append('settlementAccount', settlementAccount);

      let res: Response;
      try {
        res = await fetch(`${BASE}/api/verify?waitMs=${WAIT_MS_IMAGE}`, {
          method: 'POST',
          headers: authHeaders({
            'Idempotency-Key': `booking-${documentId}-image`,
          }),
          body: form as any,
        });
      } catch (e) {
        strapi.log.error(`Verify.ET image unreachable: ${e}`);
        await saveBooking(strapi, documentId, { payment_status: 'unverified' });
        return {
          status: 'pending',
          message:
            'Verification service is unavailable. Please try again shortly, or contact the hotel.',
        };
      }

      let json: any = await res.json().catch(() => ({}));

      if (!res.ok && res.status !== 202) {
        strapi.log.error(
          `Verify.ET image error ${res.status}: ${JSON.stringify(json)}`
        );
        const isFailed = res.status === 422;
        await saveBooking(strapi, documentId, {
          payment_status: isFailed ? 'failed' : 'unverified',
        });
        return {
          status: isFailed ? 'failed' : 'pending',
          message: isFailed
            ? 'That image could not be read as a valid receipt. Please upload a clear photo.'
            : 'We could not check your receipt right now. Our staff will confirm it manually.',
        };
      }

      const requestId = json.requestId;
      if (requestId) {
        await saveBooking(strapi, documentId, { verify_request_id: requestId });
      }

      if (res.status === 202) {
        const polled = await pollStatus(requestId);
        if (!polled) {
          await saveBooking(strapi, documentId, { payment_status: 'verifying' });
          return {
            status: 'pending',
            message:
              'Your receipt is still being checked. Please wait a moment and try again.',
          };
        }
        json = polled;
      }

      const outcome = evaluateVerifyResponse(json, booking);
      await saveBooking(strapi, documentId, outcome.save);
      return { status: outcome.status, message: outcome.message };
    },
  })
);