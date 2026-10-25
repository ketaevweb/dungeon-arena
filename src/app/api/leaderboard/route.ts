import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const results = await db.gameResult.findMany({
      orderBy: [{ wave: 'desc' }, { kills: 'desc' }],
      take: 10,
    })
    return NextResponse.json({ results })
  } catch (e) {
    console.error('leaderboard error', e)
    return NextResponse.json({ results: [] })
  }
}
