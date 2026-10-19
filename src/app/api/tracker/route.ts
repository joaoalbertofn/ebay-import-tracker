import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'tracker-db.json');

export async function GET() {
  try {
    const raw = await fs.readFile(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.shipments) && Array.isArray(parsed.cdItems)) {
      return NextResponse.json({
        exists: true,
        shipments: parsed.shipments,
        cdItems: parsed.cdItems,
        updatedAt: parsed.updatedAt || null,
      });
    }
    return NextResponse.json({ exists: false });
  } catch {
    return NextResponse.json({ exists: false });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!Array.isArray(body.shipments) || !Array.isArray(body.cdItems)) {
      return NextResponse.json(
        { error: 'Invalid payload' },
        { status: 400 }
      );
    }

    await fs.mkdir(DATA_DIR, { recursive: true });
    const payload = {
      version: 2,
      updatedAt: new Date().toISOString(),
      shipments: body.shipments,
      cdItems: body.cdItems,
    };
    await fs.writeFile(DB_FILE, JSON.stringify(payload, null, 2), 'utf-8');

    return NextResponse.json({ ok: true, updatedAt: payload.updatedAt });
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
