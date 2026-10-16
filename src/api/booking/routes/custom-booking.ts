/**
 * Custom booking routes (public — no login required for the guest flow)
 */
export default {
  routes: [
    {
      method: 'GET',
      path: '/booking-availability',
      handler: 'booking.availability',
      config: {
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/bookings/:documentId/verify-payment',
      handler: 'booking.verifyPayment',
      config: {
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/bookings/:documentId/verify-payment-image',
      handler: 'booking.verifyPaymentImage',
      config: {
        auth: false,
        middlewares: [],
      },
    },
  ],
};