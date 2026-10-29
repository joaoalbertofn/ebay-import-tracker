import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import {
  loadUserTrackerData,
  saveUserTrackerData,
} from '@/lib/trackerStorage';
import { validateTrackerPayload } from '@/lib/validation';

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const record = await loadUserTrackerData(userId);
  return NextResponse.json(record);
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const validation = validateTrackerPayload(body);
    if (!validation.success || !validation.data) {
      return NextResponse.json(
        { error: validation.error || 'Invalid payload' },
        { status: 400 }
      );
    }

    const { updatedAt } = await saveUserTrackerData(
      userId,
      validation.data.shipments,
      validation.data.cdItems
    );

    return NextResponse.json({ ok: true, updatedAt });
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
