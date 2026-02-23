// ---------------------------------------------------------------------------
// src/services/ghl.js  --  Thin GoHighLevel API client (WhatsApp + Social)
// ---------------------------------------------------------------------------

const GHL_API_KEY      = process.env.GHL_API_KEY;
const GHL_LOCATION_ID  = process.env.GHL_LOCATION_ID;
const MESSAGE_THROTTLE_MS = Number(process.env.MESSAGE_THROTTLE_MS) || 2000;

const BASE = 'https://services.leadconnectorhq.com';

const headers = () => ({
  Authorization:  `Bearer ${GHL_API_KEY}`,
  'Content-Type': 'application/json',
  Version:        '2021-07-28',
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- WhatsApp text message ------------------------------------------------

export async function sendWhatsAppMessage(contactId, message) {
  try {
    await delay(MESSAGE_THROTTLE_MS);

    const res = await fetch(`${BASE}/conversations/messages`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ type: 'WhatsApp', contactId, message }),
    });

    if (!res.ok) {
      console.error(`[services:ghl] sendWhatsAppMessage failed – ${res.status} ${res.statusText}`);
      return null;
    }

    const data = await res.json();
    return data;
  } catch (err) {
    console.error('[services:ghl] sendWhatsAppMessage error:', err);
    return null;
  }
}

// ---- WhatsApp image message -----------------------------------------------

export async function sendWhatsAppImage(contactId, imageUrl, caption) {
  try {
    await delay(MESSAGE_THROTTLE_MS);

    const res = await fetch(`${BASE}/conversations/messages`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        type: 'WhatsApp',
        contactId,
        message: caption,
        attachments: [imageUrl],
      }),
    });

    if (!res.ok) {
      console.error(`[services:ghl] sendWhatsAppImage failed – ${res.status} ${res.statusText}`);
      return null;
    }

    const data = await res.json();
    return data;
  } catch (err) {
    console.error('[services:ghl] sendWhatsAppImage error:', err);
    return null;
  }
}

// ---- Contact lookup by phone ----------------------------------------------

export async function lookupContactByPhone(phone) {
  try {
    const url = new URL(`${BASE}/contacts/search/duplicate`);
    url.searchParams.set('locationId', GHL_LOCATION_ID);
    url.searchParams.set('phone', phone);

    const res = await fetch(url, {
      method: 'GET',
      headers: headers(),
    });

    if (!res.ok) {
      console.error(`[services:ghl] lookupContactByPhone failed – ${res.status} ${res.statusText}`);
      return null;
    }

    const data = await res.json();
    return data.contact ?? null;
  } catch (err) {
    console.error('[services:ghl] lookupContactByPhone error:', err);
    return null;
  }
}

// ---- Social media post ----------------------------------------------------

export async function publishSocialPost(locationId, platforms, caption, imageUrl, scheduledAt) {
  try {
    const body = {
      locationId,
      platforms,
      caption,
      media: [{ url: imageUrl, type: 'image' }],
      scheduledAt,
    };

    const res = await fetch(`${BASE}/social-media-posting/post`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.error(`[services:ghl] publishSocialPost failed – ${res.status} ${res.statusText}`);
      return null;
    }

    const data = await res.json();
    return data;
  } catch (err) {
    console.error('[services:ghl] publishSocialPost error:', err);
    return null;
  }
}
