'use client';

import React, { useState } from 'react';
import { Disc3 } from 'lucide-react';

interface AlbumCoverProps {
  src?: string;
  alt: string;
  className?: string;
  iconClassName?: string;
}

/**
 * Renderiza a capa do álbum com carregamento otimizado (lazy + async decoding)
 * e fallback automático para o ícone <Disc3 /> caso a URL falhe (ex: 404 do Cover Art Archive).
 */
export function AlbumCover({
  src,
  alt,
  className = 'h-full w-full object-cover',
  iconClassName = 'w-5 h-5 text-slate-600',
}: AlbumCoverProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!src || failedSrc === src) {
    return <Disc3 className={iconClassName} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt || 'Capa'}
      loading="lazy"
      decoding="async"
      onError={() => setFailedSrc(src)}
      className={className}
    />
  );
}
