import { NextResponse } from 'next/server';
import Pusher from 'pusher';

export const dynamic = 'force-dynamic';

const pusher =
  process.env.PUSHER_APP_ID && process.env.PUSHER_KEY && process.env.PUSHER_SECRET
    ? new Pusher({
        appId: process.env.PUSHER_APP_ID,
        key: process.env.PUSHER_KEY,
        secret: process.env.PUSHER_SECRET,
        cluster: process.env.PUSHER_CLUSTER || 'ap2',
        useTLS: true,
      })
    : null;

export async function POST(request) {
  try {
    let body = {};
    try {
      body = await request.json();
    } catch {}

    const isOff = body.mode === 'off';
    const duration = Number(body.duration) || 5 * 60 * 1000;
    const until = isOff ? 0 : Date.now() + duration;

    if (pusher) {
      try {
        await pusher.trigger('x-monitor', isOff ? 'manual-off' : 'manual-on', {
          until,
          duration,
          timestamp: Date.now(),
        });
      } catch (err) {
        console.error('[manual-on] Failed to broadcast via Pusher:', err.message);
      }
    }

    return NextResponse.json({
      success: true,
      mode: isOff ? 'off' : 'on',
      until,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
