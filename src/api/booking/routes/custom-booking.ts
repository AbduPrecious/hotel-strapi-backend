export default {
  routes: [
    {
      method: 'POST',
      path: '/bookings/:documentId/verify-payment',
      handler: 'booking.verifyPayment',
    },
  ],
};
