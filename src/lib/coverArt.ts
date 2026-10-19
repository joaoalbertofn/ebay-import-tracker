export interface AlbumCoverCandidate {
  coverUrl: string;
  albumTitle: string;
  artistName: string;
  releaseYear?: string;
  source: 'iTunes' | 'MusicBrainz';
}

function normalizeText(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/vol\.(\d)/gi, 'vol. $1')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreCandidate(
  cand: AlbumCoverCandidate,
  targetArtist: string,
  targetAlbum: string
): number {
  const normTargetArtist = normalizeText(targetArtist);
  const normTargetAlbum = normalizeText(targetAlbum);
  const normCandArtist = normalizeText(cand.artistName);
  const normCandAlbum = normalizeText(cand.albumTitle);

  let score = 0;

  if (normTargetArtist) {
    if (normCandArtist === normTargetArtist) {
      score += 50;
    } else if (
      normCandArtist.includes(normTargetArtist) ||
      normTargetArtist.includes(normCandArtist)
    ) {
      score += 25;
    } else {
      score -= 20;
    }
  }

  if (normTargetAlbum) {
    if (normCandAlbum === normTargetAlbum) {
      score += 60;
    } else if (normCandAlbum.startsWith(normTargetAlbum)) {
      score += 45;
    } else if (normCandAlbum.includes(normTargetAlbum)) {
      score += 35;
    } else {
      const targetWords = normTargetAlbum
        .split(' ')
        .filter((w) => w.length > 1);
      let matchedWords = 0;
      for (const w of targetWords) {
        if (normCandAlbum.includes(w)) matchedWords++;
      }
      if (targetWords.length > 0) {
        score += Math.round((matchedWords / targetWords.length) * 30);
      }
    }
  }

  return score;
}

/**
 * Busca opções de capas de álbuns na internet gratuitamente combinando iTunes Search API + MusicBrainz Cover Art Archive,
 * ordenando pela maior relevância com o Artista e Álbum digitados e mantendo várias opções para o usuário alternar.
 */
export async function searchAlbumCoverCandidates(
  artist: string,
  albumTitle: string
): Promise<AlbumCoverCandidate[]> {
  const cleanArtist = artist.trim();
  const cleanAlbum = albumTitle
    .replace(/CD\s*#\d+\s*do\s*(Lote|Bundle).*/i, '')
    .replace(/\(Deluxe.*\)/i, '')
    .replace(/vol\.(\d)/gi, 'Vol. $1')
    .trim();

  const query = `${cleanArtist} ${cleanAlbum}`.trim();
  if (!query) return [];

  const rawResults: AlbumCoverCandidate[] = [];

  const itunesPromise = (async () => {
    try {
      const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(
        query
      )}&entity=album&limit=12`;

      const res = await fetch(itunesUrl);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.results)) {
          for (const item of data.results) {
            if (item.artworkUrl100) {
              const hiResCover = String(item.artworkUrl100).replace(
                '100x100bb',
                '600x600bb'
              );
              const year = item.releaseDate
                ? String(item.releaseDate).slice(0, 4)
                : undefined;

              rawResults.push({
                coverUrl: hiResCover,
                albumTitle: item.collectionName || cleanAlbum,
                artistName: item.artistName || cleanArtist,
                releaseYear: year,
                source: 'iTunes',
              });
            }
          }
        }
      }
    } catch {
      // Ignora falha individual
    }
  })();

  const mbPromise = (async () => {
    try {
      const mbQuery =
        cleanArtist && cleanAlbum
          ? `artist:"${cleanArtist}" AND release:"${cleanAlbum}"`
          : query;
      const mbUrl = `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(
        mbQuery
      )}&limit=6&fmt=json`;

      const mbRes = await fetch(mbUrl, {
        headers: {
          Accept: 'application/json',
        },
      });

      if (mbRes.ok) {
        const mbData = await mbRes.json();
        const groups = mbData['release-groups'] || [];
        for (const g of groups) {
          if (g.id) {
            const coverUrl = `https://coverartarchive.org/release-group/${g.id}/front-500`;
            const year = g['first-release-date']
              ? String(g['first-release-date']).slice(0, 4)
              : undefined;
            const artistCredit =
              g['artist-credit']?.[0]?.name || cleanArtist;

            rawResults.push({
              coverUrl,
              albumTitle: g.title || cleanAlbum,
              artistName: artistCredit,
              releaseYear: year,
              source: 'MusicBrainz',
            });
          }
        }
      }
    } catch {
      // Ignora falha individual
    }
  })();

  await Promise.all([itunesPromise, mbPromise]);

  // Remove URLs duplicadas e ordena pelo score de compatibilidade com Banda + Álbum
  const uniqueMap = new Map<string, AlbumCoverCandidate>();
  for (const item of rawResults) {
    if (!uniqueMap.has(item.coverUrl)) {
      uniqueMap.set(item.coverUrl, item);
    }
  }

  const deduplicated = Array.from(uniqueMap.values());
  deduplicated.sort(
    (a, b) =>
      scoreCandidate(b, cleanArtist, cleanAlbum) -
      scoreCandidate(a, cleanArtist, cleanAlbum)
  );

  return deduplicated;
}

/**
 * Retorna diretamente a melhor capa encontrada (usado na busca automática em lote).
 */
export async function fetchBestAlbumCover(
  artist: string,
  albumTitle: string
): Promise<AlbumCoverCandidate | null> {
  const candidates = await searchAlbumCoverCandidates(artist, albumTitle);
  return candidates[0] || null;
}
