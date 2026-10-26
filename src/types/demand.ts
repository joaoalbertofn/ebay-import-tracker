export type DemandFormat = 'CD' | 'Vinyl';

export type DemandSortMode = 'opportunity' | 'scarcity' | 'wants';

export type BrazilMarketVerdict =
  | 'white_whale' // 0 anúncios no Brasil (Mosca Branca)
  | 'opportunity' // Poucos anúncios (<= 10) e/ou preço alto (>= R$ 130)
  | 'competitive' // Oferta moderada ou preço intermediário
  | 'saturated'; // Muitos anúncios (> 20) ou preço baixo (< R$ 90 com oferta)

export interface SubgenreOption {
  id: string;
  label: string;
  discogsStyle: string; // Empty string means all Rock/Metal
}

export const ROCK_METAL_SUBGENRES: SubgenreOption[] = [
  { id: 'all', label: 'Todos (Rock & Metal)', discogsStyle: '' },
  { id: 'nu-metal', label: 'Nu Metal', discogsStyle: 'Nu Metal' },
  { id: 'heavy-metal', label: 'Heavy Metal', discogsStyle: 'Heavy Metal' },
  { id: 'alt-rock', label: 'Alternative Rock', discogsStyle: 'Alternative Rock' },
  { id: 'thrash', label: 'Thrash Metal', discogsStyle: 'Thrash' },
  { id: 'death-metal', label: 'Death Metal', discogsStyle: 'Death Metal' },
  { id: 'black-metal', label: 'Black Metal', discogsStyle: 'Black Metal' },
  { id: 'grunge', label: 'Grunge', discogsStyle: 'Grunge' },
  { id: 'hard-rock', label: 'Hard Rock', discogsStyle: 'Hard Rock' },
  { id: 'classic-rock', label: 'Classic Rock', discogsStyle: 'Classic Rock' },
  { id: 'prog-metal', label: 'Progressive Metal', discogsStyle: 'Progressive Metal' },
  { id: 'prog-rock', label: 'Prog Rock', discogsStyle: 'Prog Rock' },
  { id: 'punk-hc', label: 'Punk / Hardcore', discogsStyle: 'Hardcore' },
  { id: 'emo', label: 'Emo / Post-Hardcore', discogsStyle: 'Emo' },
  { id: 'industrial', label: 'Industrial', discogsStyle: 'Industrial' },
  { id: 'doom-stoner', label: 'Doom / Stoner', discogsStyle: 'Doom Metal' },
  { id: 'power-metal', label: 'Power Metal', discogsStyle: 'Power Metal' },
  { id: 'symphonic', label: 'Symphonic / Gothic', discogsStyle: 'Symphonic Metal' },
];

export interface TopAlbumItem {
  id: number;
  artist: string;
  albumTitle: string;
  fullTitle: string;
  year?: string;
  country?: string;
  format: DemandFormat;
  styles: string[];
  coverUrl: string;
  wants: number;
  haves: number;
  scarcityRatio: number; // wants / max(haves, 1)
  opportunityScore: number; // Score que equilibra Alta Procura + Escassez Real + Ausência de Prensagem BR
  isCommonClassic: boolean; // True apenas se tiver tiragem massiva (>5.000 haves) ou prensagem nacional abundante
  brazilPressingHaves?: number; // Quantidade de colecionadores que possuem prensagem brasileira (country=Brazil) no Discogs (0 = Sem tiragem oficial no BR)
  discogsUrl: string;
  ebaySearchUrl: string;
  mlSearchUrl: string;
  // Campos adicionais usados na busca de posição no ranking
  estimatedRank?: number;
  isInsideTop100?: boolean;
  wantsToReachTop100?: number;
  top100CutoffWants?: number;
}

export interface MercadoLivreListingSample {
  id: string;
  title: string;
  price: number;
  permalink: string;
  thumbnail?: string;
  condition?: string;
}

export interface MercadoLivreOfferSummary {
  query: string;
  totalActiveListings: number; // Total na busca com Envio Nacional
  matchedAlbumCount: number; // Quantidade filtrada daquele álbum específico (sem lotes/outliers)
  lowestPriceBrl: number | null;
  averagePriceBrl: number | null;
  medianPriceBrl: number | null;
  highestPriceBrl: number | null;
  verdict: BrazilMarketVerdict;
  verdictLabel: string;
  verdictReason: string;
  searchUrl: string;
  topItems: MercadoLivreListingSample[];
  sourceNote?: string;
  requiresMlSession?: boolean;
}
