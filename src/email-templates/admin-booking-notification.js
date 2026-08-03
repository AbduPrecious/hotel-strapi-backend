// src/email-templates/admin-booking-notification.js
module.exports = (booking) => {
  return {
    subject: `🛑 NEW BOOKING: ${booking.name} - ETB ${booking.total}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
        <div style="background: linear-gradient(135deg, #1956ff, #7a36f8); padding: 20px; border-radius: 10px 10px 0 0; color: white; text-align: center;">
          <h1 style="margin: 0;">🛑 New Booking!</h1>
        </div>
        <div style="padding: 20px;">
          <h2 style="color: #333;">Booking Details</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0;"><strong>Guest Name:</strong></td>
              <td style="padding: 8px 0;">${booking.name}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0;"><strong>Email:</strong></td>
              <td style="padding: 8px 0;">${booking.email}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0;"><strong>Phone:</strong></td>
              <td style="padding: 8px 0;">${booking.phone}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0;"><strong>Room:</strong></td>
              <td style="padding: 8px 0;">${booking.roomTitle}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0;"><strong>Check-in:</strong></td>
              <td style="padding: 8px 0;">${new Date(booking.check_in).toLocaleDateString()}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0;"><strong>Check-out:</strong></td>
              <td style="padding: 8px 0;">${new Date(booking.check_out).toLocaleDateString()}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0;"><strong>Total:</strong></td>
              <td style="padding: 8px 0; font-size: 18px; font-weight: bold; color: #1956ff;">ETB ${booking.total}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0;"><strong>Status:</strong></td>
              <td style="padding: 8px 0;">
                <span style="background: #f59e0b; color: white; padding: 2px 10px; border-radius: 20px; font-size: 12px;">PENDING</span>
              </td>
            </tr>
          </table>
          <div style="margin-top: 20px; text-align: center;">
            <a href="${process.env.STRAPI_ADMIN_URL}/admin/content-manager/collectionType/api::booking.booking/${booking.documentId}" 
               style="background: linear-gradient(135deg, #1956ff, #7a36f8); color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
              View Booking in Strapi
            </a>
          </div>
        </div>
        <div style="background: #f5f5f5; padding: 15px; border-radius: 0 0 10px 10px; text-align: center; color: #666; font-size: 12px;">
          <p>This is an automated notification from your hotel booking system.</p>
        </div>
      </div>
    `,
  };
};