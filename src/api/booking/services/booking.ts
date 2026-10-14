/**
 * booking service
 */

import { factories } from '@strapi/strapi';

const BASE = process.env.VERIFY_ET_BASE_URL || 'https://verify.et';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function headers(extra: Record<string, string> = {}) {
  return { 'x-api-key': process.env.VERIFY_ET_API_KEY as string, ...extra };
}

// Reads the hotel's receiving account from the payment-method single type
async function getReceivingAccount(strapi: any, bank: string): Promise<string | null> {
  const pm: any = await strapi
    .documents('api::payment-method.payment-method')
    .findFirst({ status: 'published' });
  const raw =
    bank === 'cbe' ? pm?.cbe_account_number
    : bank === 'telebirr' ? pm?.telebirr_number
    : null;
  // keep digits only: "+251 912 345 678" -> "251912345678"
  const clean = raw ? String(raw).replace(/\D/g, '') : '';
  return clean || null;
}

function buildBody(b: any, settlementAccount: string) {
  const body: any = {
    bank: b.payment_bank,
    reference: String(b.payment_reference).trim(),
    settlementAccount,
  };
  if (b.payment_suffix) {
    if (b.payment_bank === 'cbebirr') body.phoneNumber = b.payment_suffix;
    else body.suffix = b.payment_suffix;
  }
  return body;
}

async function pollStatus(requestId: string) {
  for (let i = 0; i < 10; i++) {
    await sleep(2000);
    const res = await fetch(`${BASE}/api/verify/${encodeURIComponent(requestId)}`, {
      headers: headers(),
    });
    const json: any = await res.json().catch(() => ({}));
    const s = json?.data?.processingStatus;
    if (s === 'completed' || s === 'failed') return json;
  }
  return null;
}

export default factories.createCoreService('api::booking.booking', ({ strapi }) => ({
  async verifyPayment(documentId: string) {
    const docs = strapi.documents('api::booking.booking');
    const booking: any = await docs.findOne({ documentId });

    if (!booking) return { code: 'not_found' };
    if (booking.payment_status === 'verified') {
      return { status: 'verified', message: 'Payment already verified.' };
    }
    if (booking.payment_method !== 'bank_transfer') {
      return { code: 'bad_request', message: 'This booking is not a bank transfer.' };
    }
    if (!booking.payment_bank || !booking.payment_reference) {
      return { code: 'bad_request', message: 'Select a bank and enter the reference number.' };
    }

    const save = async (data: any) => {
      await docs.update({ documentId, data } as any);
      await docs.publish({ documentId } as any);
    };

    // Same receipt cannot pay for two bookings
    const dup: any[] = await docs.findMany({
      filters: {
        payment_reference: booking.payment_reference.trim(),
        payment_status: 'verified',
        documentId: { $ne: documentId },
      },
      limit: 1,
    } as any);
    if (dup.length) {
      await save({ payment_status: 'failed' });
      return { status: 'failed', message: 'This payment reference was already used for another booking.' };
    }

    // The hotel's receiving account, read from Strapi (payment-method)
    const settlementAccount = await getReceivingAccount(strapi, booking.payment_bank);
    if (!settlementAccount) {
      strapi.log.error(`No receiving account set in payment-method for ${booking.payment_bank}`);
      await save({ payment_status: 'unverified' });
      return {
        status: 'pending',
        message: 'We could not check your payment automatically. Our staff will confirm it manually.',
      };
    }

    await save({ payment_status: 'verifying' });

    // Submit to Verify.ET
    let res: Response;
    try {
      res = await fetch(`${BASE}/api/verify?waitMs=10000`, {
        method: 'POST',
        headers: headers({
          'Content-Type': 'application/json',
          'Idempotency-Key': `booking-${documentId}-${booking.payment_reference.trim()}`,
        }),
        body: JSON.stringify(buildBody(booking, settlementAccount)),
      });
    } catch (e) {
      strapi.log.error(`Verify.ET unreachable: ${e}`);
      await save({ payment_status: 'unverified' });
      return { status: 'pending', message: 'Verification service is unavailable. Please try again shortly.' };
    }

    let json: any = await res.json().catch(() => ({}));

    if (!res.ok && res.status !== 202) {
      strapi.log.error(`Verify.ET error ${res.status}: ${JSON.stringify(json)}`);
      // 401/402/429/503 are our-side or temporary problems, not the guest's fault
      await save({ payment_status: res.status === 422 ? 'failed' : 'unverified' });
      return {
        status: res.status === 422 ? 'failed' : 'pending',
        message:
          res.status === 422
            ? 'The reference number format looks wrong for this bank. Please check it.'
            : 'We could not check your payment right now. Our staff will confirm it manually.',
      };
    }

    const requestId = json.requestId;
    if (requestId) await save({ verify_request_id: requestId });

    if (res.status === 202) {
      const polled = await pollStatus(requestId);
      if (!polled) {
        await save({ payment_status: 'verifying' });
        return { status: 'pending', message: 'Your payment is still being checked. Please wait a moment.' };
      }
      json = polled;
    }

       const raw: any = Array.isArray(json.data) ? json.data[0] : json.data;
    const item: any = raw?.result ?? raw;

    if (!item || item.verified !== true) {
      await save({ payment_status: 'failed' });
      return { status: 'failed', message: 'We could not find this payment. Please check the reference number.' };
    }

    // Amount must be present and cover the booking total
    if (item.amount === undefined || item.amount === null) {
      await save({ payment_status: 'verifying' });
      return { status: 'pending', message: 'Payment found. Our staff will confirm the details shortly.' };
    }
    if (Number(item.amount) < Number(booking.total)) {
      await save({ payment_status: 'failed' });
      return { status: 'failed', message: 'The paid amount is less than the booking total.' };
    }

    // Money must have gone to the hotel's account
    if (process.env.VERIFY_ET_REQUIRE_RECEIVER_MATCH !== 'false') {
      if (item.settlementAccountMatch?.matched !== true) {
        await save({ payment_status: 'failed' });
        return { status: 'failed', message: 'This payment was not sent to the hotel account.' };
      }
    }

    const approve = process.env.VERIFY_ET_AUTO_APPROVE !== 'false';
    await save({
      payment_status: 'verified',
      verified_at: new Date().toISOString(),
      ...(approve ? { booking_status: 'Approved' } : {}),
    });

    return { status: 'verified', message: 'Payment verified. Your booking is confirmed!' };
  },
}));