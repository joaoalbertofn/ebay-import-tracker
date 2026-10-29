import { useState } from 'react';
import { EbayImportResult } from '@/lib/ebayImport';

export interface EbayImportFeedback {
  type: 'success' | 'warning';
  text: string;
}

export function useEbayQuickPaste() {
  const [isParsingEbay, setIsParsingEbay] = useState(false);
  const [ebayImportFeedback, setEbayImportFeedback] =
    useState<EbayImportFeedback | null>(null);

  const parseEbay = async (
    rawInput: string
  ): Promise<EbayImportResult | null> => {
    const raw = rawInput.trim();
    if (!raw) return null;

    setIsParsingEbay(true);
    setEbayImportFeedback(null);

    try {
      const res = await fetch('/api/ebay/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: raw }),
      });

      const data: EbayImportResult & { error?: string } = await res.json();

      if (!res.ok || data.error) {
        setEbayImportFeedback({
          type: 'warning',
          text: data.error || 'Não foi possível ler os dados informados.',
        });
        return null;
      }

      return data;
    } catch {
      setEbayImportFeedback({
        type: 'warning',
        text: 'Falha ao consultar dados do eBay. Verifique o link ou texto colado.',
      });
      return null;
    } finally {
      setIsParsingEbay(false);
    }
  };

  const clearFeedback = () => setEbayImportFeedback(null);

  return {
    isParsingEbay,
    ebayImportFeedback,
    setEbayImportFeedback,
    parseEbay,
    clearFeedback,
  };
}
