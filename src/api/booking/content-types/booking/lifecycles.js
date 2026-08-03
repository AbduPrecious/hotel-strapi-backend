// src/api/booking/content-types/booking/lifecycles.js
const adminTemplate = require('../../../../email-templates/admin-booking-notification');
const userTemplate = require('../../../../email-templates/user-booking-status');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@yourhotel.com';

// Helper: Get room title
async function getRoomTitle(roomId) {
  try {
    const entry = await strapi.entityService.findOne('api::room.room', roomId);
    return entry?.title || 'Room';
  } catch (error) {
    return 'Room';
  }
}

// Helper: Send email
async function sendEmail(to, subject, html) {
  try {
    await strapi.plugins['email'].services.email.send({
      to,
      subject,
      html,
    });
    return true;
  } catch (error) {
    console.error('❌ Email sending failed:', error);
    return false;
  }
}

module.exports = {
  // ─── When a new booking is created ──────────────────
  async afterCreate(event) {
    const { result } = event;
    const booking = result;

    console.log('📧 Sending admin notification...');

    const roomTitle = await getRoomTitle(booking.room);

    const bookingData = {
      ...booking,
      roomTitle,
    };

    await sendEmail(
      ADMIN_EMAIL,
      adminTemplate(bookingData).subject,
      adminTemplate(bookingData).html
    );

    console.log('✅ Admin notification sent');
  },

  // ─── When a booking is updated (status changes) ─────
  async afterUpdate(event) {
    const { result, params } = event;
    const booking = result;

    const oldStatus = params?.data?.booking_status;
    const newStatus = booking.booking_status;

    if (oldStatus !== newStatus && ['Approved', 'Rejected'].includes(newStatus)) {
      console.log(`📧 Booking ${booking.documentId} status changed to ${newStatus}`);

      const roomTitle = await getRoomTitle(booking.room);

      const bookingData = {
        ...booking,
        roomTitle,
      };

      await sendEmail(
        booking.email,
        userTemplate(bookingData, newStatus.toLowerCase()).subject,
        userTemplate(bookingData, newStatus.toLowerCase()).html
      );

      console.log(`✅ User notification sent to ${booking.email}`);
    }
  },
};