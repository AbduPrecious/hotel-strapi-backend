export default {
  routes: [
    {
      method: 'POST',
      path: '/bookings/:documentId/verify-payment',
      handler: 'booking.verifyPayment',
    },
    {
      method: 'GET',
      path: '/booking-availability',
      handler: 'booking.availability',
    },
  ],
};
