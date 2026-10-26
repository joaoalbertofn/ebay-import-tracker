import { NextRequest, NextResponse } from 'next/server';
import { DemandFormat } from '@/types/demand';
import {
  getOrFetchTop100,
  resolveDiscogsAuthHeader,
} from '@/lib/discogsDemand';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const formatParam = (searchParams.get('format') || 'CD') as DemandFormat;
  const format: DemandFormat = formatParam === 'Vinyl' ? 'Vinyl' : 'CD';
  const style = (searchParams.get('style') || '').trim();
  const forceRefresh = searchParams.get('refresh') === '1';

  const { authHeader } = resolveDiscogsAuthHeader(
    request.headers.get('x-discogs-token')
  );

  if (!authHeader) {
    return NextResponse.json({
      requiresToken: true,
      items: [],
      message:
        'Configure suas credenciais gratuitas do Discogs para carregar o Top 100.',
    });
  }

  try {
    const { items, cached } = await getOrFetchTop100({
      format,
      style,
      authHeader,
      forceRefresh,
    });

    return NextResponse.json({
      requiresToken: false,
      cached,
      items,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    if (msg === 'INVALID_DISCOGS_TOKEN') {
      return NextResponse.json(
        {
          requiresToken: true,
          items: [],
          message:
            'Credenciais do Discogs inválidas ou expiradas. Verifique as chaves em .env.local.',
        },
        { status: 401 }
      );
    }

    return NextResponse.json(
      {
        requiresToken: false,
        items: [],
        message: `Erro ao consultar a API do Discogs (${msg}). Tente novamente em instantes.`,
      },
      { status: 502 }
    );
  }
}
