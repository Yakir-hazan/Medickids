// api/notify.js — Vercel Serverless Function
// REST API Key שמור ב-ONESIGNAL_API_KEY Environment Variable ב-Vercel

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', 'https://medickids.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { title, message, childName, scheduledTime, externalId, buttons } = req.body;

  if (!title || !message) {
    return res.status(400).json({ error: 'title and message are required' });
  }

  const payload = {
    app_id: process.env.ONESIGNAL_APP_ID,
    included_segments: ['Total Subscriptions'],
    headings: { en: title, he: title },
    contents: { en: message, he: message },
    data: { childName, externalId },
  };

  // כפתורי פעולה מהירה
  if (buttons) {
    payload.web_buttons = buttons;
  }

  // תזמון לשעה עתידית
  if (scheduledTime) {
    payload.send_after = scheduledTime; // ISO string: "2024-01-01T10:00:00Z"
  }

  try {
    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Key ${process.env.ONESIGNAL_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data });
    }

    return res.status(200).json({ success: true, notificationId: data.id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
