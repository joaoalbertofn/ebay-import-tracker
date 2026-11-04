import { describe, expect, it } from 'vitest';
import {
  detectDiscCountFromTitle,
  detectMediaTypeFromTitle,
  parseEbayListingTitle,
  parseEbayOrderCopiedText,
} from '@/lib/ebayImport';

describe('ebayImport — Detecção de Vinil / LP e eBay US Orders', () => {
  it('detecta mediaType e discCount em títulos de Vinil (1 LP e 2 LP)', () => {
    const title1 = 'Him Tears On Tape Clear Vinyl LP 2024 Limited Edition';
    expect(detectMediaTypeFromTitle(title1)).toBe('vinyl');
    expect(detectDiscCountFromTitle(title1)).toBe(1);

    const parsed1 = parseEbayListingTitle(title1);
    expect(parsed1.artist).toBe('HIM');
    expect(parsed1.albumTitle).toBe('Tears On Tape');
    expect(parsed1.releaseYear).toBe('2024');
    expect(parsed1.discCount).toBe(1);
    expect(parsed1.mediaType).toBe('vinyl');

    const title2 =
      'Him When Love and Death Embrace Best Of 1997-2003 White Vinyl 2 LP 2023';
    expect(detectMediaTypeFromTitle(title2)).toBe('vinyl');
    expect(detectDiscCountFromTitle(title2)).toBe(2);

    const parsed2 = parseEbayListingTitle(title2);
    expect(parsed2.artist).toBe('HIM');
    expect(parsed2.albumTitle).toContain('When Love and Death Embrace');
    expect(parsed2.releaseYear).toBe('2023');
    expect(parsed2.discCount).toBe(2);
    expect(parsed2.mediaType).toBe('vinyl');
  });

  it('faz o parse completo do Pedido #1 do eBay US (Him Tears On Tape Clear Vinyl LP)', () => {
    const orderText1 = `
TRACKING PROVIDED
Arrives Fri, Nov 6 - Thu, Nov 12
Him Tears On Tape Clear Vinyl LP 2024 Limited Edition
Track Package

You got a refund! A total of $5.00 was sent on Nov 3, 2026.

Order info
Time placed	Nov 3, 2026 at 6:45 PM
Order number	11-15381-72197
Total	$13.00 (1 item)
Sold by	aspenleaf-handmade-and-vintage

Delivery info
Arriving by Thu, Nov 12
Paid Nov 3
Tracking available Nov 3
Delivered

Tracking details
Number	9449008106245751895056

Item info
Him Tears On Tape Clear Vinyl LP 2024 Limited Edition	$13.00
Item number: 147661373137

Shipping address
Joao Novaes
3065 Tradeport Dr, Suite 977242
Orlando, Florida 32824-7015
United States

Payment info
Ending in 1615 $18.00
Ending in 1615 -$5.00
1 item	$13.00
Shipping	$5.00
Amount paid	$18.00
Total refunded	-$5.00
Order total	$13.00
    `;

    const parsed = parseEbayOrderCopiedText(orderText1);
    expect(parsed).not.toBeNull();
    expect(parsed!.ebayOrderId).toBe('11-15381-72197');
    expect(parsed!.currency).toBe('USD');
    expect(parsed!.localTrackingCode).toBe('9449008106245751895056');
    expect(parsed!.bundleTotalValue).toBe(13.0);
    expect(parsed!.internalShipping).toBe(5.0);
    expect(parsed!.items).toHaveLength(1);
    expect(parsed!.items[0].artist).toBe('HIM');
    expect(parsed!.items[0].albumTitle).toBe('Tears On Tape');
    expect(parsed!.items[0].mediaType).toBe('vinyl');
    expect(parsed!.items[0].discCount).toBe(1);
    expect(parsed!.items[0].unitPrice).toBe(13.0);
  });

  it('faz o parse completo do Pedido #2 do eBay US (Him When Love and Death Embrace 2 LP)', () => {
    const orderText2 = `
TRACKING PROVIDED
Arrives Fri, Nov 6 - Thu, Nov 12
Him When Love and Death Embrace Best Of 1997-2003 White Vinyl 2 LP 2023
Track Package

Order info
Time placed	Nov 3, 2026 at 7:00 PM
Order number	27-15352-14807
Total	$33.00 (1 item)
Sold by	aspenleaf-handmade-and-vintage

Tracking details
Number	9449008106245751895056

Item info
Him When Love and Death Embrace Best Of 1997-2003 White Vinyl 2 LP 2023	$28.00
Item number: 147661364682
Used

Payment info
1 item	$28.00
Shipping	$5.00
Order total	$33.00
    `;

    const parsed = parseEbayOrderCopiedText(orderText2);
    expect(parsed).not.toBeNull();
    expect(parsed!.ebayOrderId).toBe('27-15352-14807');
    expect(parsed!.currency).toBe('USD');
    expect(parsed!.localTrackingCode).toBe('9449008106245751895056');
    expect(parsed!.bundleTotalValue).toBe(28.0);
    expect(parsed!.internalShipping).toBe(5.0);
    expect(parsed!.items).toHaveLength(1);
    expect(parsed!.items[0].artist).toBe('HIM');
    expect(parsed!.items[0].albumTitle).toContain('When Love and Death Embrace');
    expect(parsed!.items[0].mediaType).toBe('vinyl');
    expect(parsed!.items[0].discCount).toBe(2);
    expect(parsed!.items[0].releaseYear).toBe('2023');
    expect(parsed!.items[0].unitPrice).toBe(28.0);
  });
});
