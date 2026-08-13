// scripts/fix-booking-rooms.js
const API_URL = 'http://localhost:1337/api';
const TOKEN = '10af4557794c58d0221061e80412e2aa13cb79203b3ae1b9b88191cb7b6b4be8537f5702ac0aed94ab9bf8361e37d36f82537a1b07841b323ea71207a17215dfee406246612efe3e9595e9db7a8496fde1dbf4e24c74edff62bf169494e4b45e97cbf60f2b53f6670aa8c1fc8fce091b78143f5ecb6c97e551ba5145ac82a948'; // Replace with your actual token
const DEFAULT_ROOM_ID = 37; // Replace with the ID of a room you want to link

async function fixBookings() {
  console.log('🔍 Fetching all bookings...');

  const res = await fetch(`${API_URL}/bookings?populate[room]=true`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });

  if (!res.ok) {
    const error = await res.text();
    console.error(`❌ Failed to fetch bookings: ${error}`);
    return;
  }

  const data = await res.json();
  const bookings = data.data || [];
  console.log(`📊 Found ${bookings.length} bookings.`);

  let updated = 0;
  let skipped = 0;

  for (const booking of bookings) {
    const bookingData = booking.attributes || booking;

    if (bookingData.room) {
      console.log(`⏭️ Booking ${bookingData.documentId || bookingData.id} already has a room. Skipping.`);
      skipped++;
      continue;
    }

    const docId = bookingData.documentId || bookingData.id;
    console.log(`🔗 Linking room to booking ${docId}...`);

    const updateRes = await fetch(`${API_URL}/bookings/${docId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({
        data: { room: DEFAULT_ROOM_ID },
      }),
    });

    if (updateRes.ok) {
      console.log(`✅ Booking ${docId} updated.`);
      updated++;
    } else {
      const errorText = await updateRes.text();
      console.error(`❌ Failed to update booking ${docId}: ${errorText}`);
    }
  }

  console.log(`\n🎉 Done! Updated ${updated} bookings, skipped ${skipped}.`);
}

fixBookings().catch(console.error);