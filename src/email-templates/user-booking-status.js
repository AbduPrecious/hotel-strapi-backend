// src/email-templates/user-booking-status.js
module.exports = (booking, status) => {
  const statusColors = {
    approved: { bg: '#10b981', text: 'Approved ✅', emoji: '🎉' },
    rejected: { bg: '#ef4444', text: 'Rejected ❌', emoji: '😞' },
  };

  const statusInfo = statusColors[status] || statusColors.approved;

  const messages = {
    approved: {
      title: '🎉 Your Booking Has Been Approved!',
      body: 'Great news! Your booking has been confirmed. We look forward to welcoming you!',
    },
    rejected: {
      title: '😞 Booking Update',
      body: 'Unfortunately, your booking could not be confirmed at this time. Please contact us for more details.',
    },
  };

  const msg = messages[status];

  return {
    subject: `${statusInfo.emoji} Booking ${statusInfo.text} - ${booking.roomTitle}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
        <div style="background: ${statusInfo.bg}; padding: 20px; border-radius: 10px 10px 0 0; color: white; text-align: center;">
          <h1 style="margin: 0;">${msg.title}</h1>
        </div>
        <div style="padding: 20px;">
          <p style="font-size: 16px; color: #333;">Dear <strong>${booking.name}</strong>,</p>
          <p style="font-size: 16px; color: #555;">${msg.body}</p>
          
          <h2 style="color: #333; margin-top: 20px;">Booking Details</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0;"><strong>Room:</strong></td>
              <td style="padding: 8px 0;">${booking.roomTitle}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0;"><strong>Dates:</strong></td>
              <td style="padding: 8px 0;">${new Date(booking.check_in).toLocaleDateString()} – ${new Date(booking.check_out).toLocaleDateString()}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0;"><strong>Total:</strong></td>
              <td style="padding: 8px 0; font-size: 18px; font-weight: bold; color: #1956ff;">ETB ${booking.total}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0;"><strong>Status:</strong></td>
              <td style="padding: 8px 0;">
                <span style="background: ${statusInfo.bg}; color: white; padding: 2px 10px; border-radius: 20px; font-size: 12px;">
                  ${statusInfo.text}
                </span>
              </td>
            </tr>
          </table>

          <div style="margin-top: 25px; text-align: center;">
            <a href="${process.env.FRONTEND_URL}/dashboard?email=${encodeURIComponent(booking.email)}" 
               style="background: linear-gradient(135deg, #1956ff, #7a36f8); color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
              View Your Dashboard
            </a>
          </div>
          
          <div style="margin-top: 20px; padding: 15px; background: #f5f5f5; border-radius: 5px;">
            <p style="margin: 0; color: #666; font-size: 14px;">
              <strong>Need help?</strong> Contact us at ${process.env.ADMIN_EMAIL}
            </p>
          </div>
        </div>
        <div style="background: #f5f5f5; padding: 15px; border-radius: 0 0 10px 10px; text-align: center; color: #666; font-size: 12px;">
          <p>This is an automated notification from your hotel booking system.</p>
          <p>© ${new Date().getFullYear()} ${booking.hotelName || 'Your Hotel'}.</p>
        </div>
      </div>
    `,
  };
};