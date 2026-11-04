import { describe, expect, it } from 'vitest';
import {
  detectDiscCountFromTitle,
  detectMediaTypeFromTitle,
  extractEbayItemIds,
  extractEbayListingUrls,
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

  it('faz o parse limpo da página inteira de anúncio do eBay (HIM – Love Metal – 267826634198) ignorando Similar Items, Inspired by views, Feedback e Best Sellers', () => {
    const fullListingPageCopied = `[Skip to main content](https://www.ebay.com/itm/267826634198#mainContent)
Hi Joao!
[Deals](https://www.ebay.com/deals)[Brand Outlet](https://www.ebay.com/b/Brand-Outlet/bn_7115532402)[Help & Contact](https://www.ebay.com/help/home)
[Sell](https://www.ebay.com/sl/sell)Expand Sell Menu
[Watchlist](https://www.ebay.com/mye/myebay/watchlist)Expand Watch List
[My eBay](https://www.ebay.com/mys/home?source=GBH)Expand My eBay
Notifications
[1](https://cart.ebay.com/)Expand Cart
Shop by category
All CategoriesAntiquesArtBabyBooksBusiness & IndustrialCameras & PhotoCell Phones & AccessoriesClothing, Shoes & AccessoriesCoins & Paper MoneyCollectiblesComputers/Tablets & NetworkingConsumer ElectronicsCraftsDolls & BearsMovies & TVeBay MotorsEntertainment MemorabiliaGift Cards & CouponsHealth & BeautyHome & GardenJewelry & WatchesMusicMusical Instruments & GearPet SuppliesPottery & GlassReal EstateSpecialty ServicesSporting GoodsSports Mem, Cards & Fan ShopStampsTickets & ExperiencesToys & HobbiesTravelVideo Games & ConsolesEverything Else
Search[Advanced](https://www.ebay.com/sch/ebayadvsearch)
You bought this item. [View order details](https://order.ebay.com/ord/show?orderId=18-15369-98843&ssPageName=STRK:MESO:VPS&_trksid=p4429486.m2548.l2673)
Have one to sell?
[Sell one like this](https://www.ebay.com/sl/list?mode=SellLikeItem&itemId=267826634198&rt=nc&_trksid=p4429486.m117039.l2792)
[Sell something else](https://www.ebay.com/sl/prelist/suggest)
Share
HIM – Love Metal – CD Album – Cardboard Fold Edition
[A](https://www.ebay.com/sch/aowe4778/m.html?item=267826634198&rt=nc&_trksid=p4429486.m3561.l161210)
[aowe4778](https://www.ebay.com/sch/aowe4778/m.html?item=267826634198&rt=nc&_trksid=p4429486.m3561.l161211)
(371)
100% positive
[Seller's other itemsSeller's other items](https://www.ebay.com/sch/aowe4778/m.html?item=267826634198&rt=nc&_trksid=p4429486.m3561.l170197)
Message
GBP 15.00or Best Offer
ApproximatelyUS $20.12
Best offer accepted
Condition:
Very GoodVery Good
Shipping, returns, and payments
Shipping:
GBP 0.91 (approx US $1.22) Royal Mail 2nd Class Letter. See detailsfor shipping
Located in: Ellesmere Port, United Kingdom
Delivery:
Estimated between Mon, Nov 9 and Tue, Nov 10 to SO19 7GA
Returns:
Seller does not accept returns. See details- for more information about returns
Payments:
Shop with confidence
eBay Money Back Guarantee
Get the item you ordered or your money back. [Learn moreeBay Money Back Guarantee - opens new window or tab](https://www.ebay.com/ebay-money-back-guarantee/)
Similar Items
[See all](https://www.ebay.com/recs?item_id=267826634198)
[HIM -DARK LIGHT- 2005](https://www.ebay.com/itm/287694990031)
Pre-owned · Private
$14.99
+ $12.32 delivery
[HIM 2x CD Album Bundle - Razorblade Romance (2000) & Love Metal (2003)](https://www.ebay.com/itm/287697160395)
Pre-owned · Private
$18.67
Free delivery
[Foo Fighters 8 CD Lot - Wasting Light In Your Honor One By One Sonic Highways](https://www.ebay.com/itm/137881874895)
Pre-owned · Private
$18.67
+ $3.78 delivery
Inspired by your recent views
[HIM Razorblade Romance CD Album RCA Rock 2000 2000s Jewel Case Standard poster](https://www.ebay.com/itm/820274087910)
New · Private
$9.39
+ $1.22 delivery
About this item
Seller assumes all responsibility for this listing.
eBay item number:267826634198
Item specifics
Condition
Very Good: An item that is used but still in very good condition. No damage to the jewel case or ... Read moreabout the condition
Artist
HIM
Type
Album
Format
CD
Language
English
Release Title
love metal
Case Type
Jewel Case: Standard
Genre
Metal
Category
breadcrumb[Books, Movies & Music](https://www.ebay.com/b/Books-Movies-Music/bn_7000259849)
[Music](https://www.ebay.com/b/Music/11233/bn_1861335)
[CDs](https://www.ebay.com/b/Music-CDs/176984/bn_221164)
Item description from the seller
About this seller
Seller feedback (80)
Ibanez Tube Screamer TS808 Overdrive Guitar Effects Pedal - With True Bypass (#265677297414)
Shop Top Sellers and Highly Rated Products in CDs
Best Sellers
[Graduation by Kanye West (CD, 2007)](https://www.ebay.com/p/9046036620)
[Weezer by Weezer (CD, 1994)](https://www.ebay.com/p/26046069709)`;

    const urls = extractEbayListingUrls(fullListingPageCopied);
    expect(urls).toEqual(['https://www.ebay.com/itm/267826634198']);

    const ids = extractEbayItemIds(fullListingPageCopied);
    expect(ids).toEqual(['267826634198']);

    const parsed = parseEbayOrderCopiedText(fullListingPageCopied);
    expect(parsed.ebayOrderId).toBe('18-15369-98843');
    expect(parsed.currency).toBe('GBP');
    expect(parsed.internalShipping).toBe(0.91);
    expect(parsed.bundleTotalValue).toBe(15);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].artist).toBe('HIM');
    expect(parsed.items[0].albumTitle).toBe('Love Metal');
    expect(parsed.items[0].mediaType).toBe('cd');
    expect(parsed.items[0].discCount).toBe(1);
    expect(parsed.items[0].unitPrice).toBe(15);
    expect(parsed.items[0].ebayListingUrl).toBe(
      'https://www.ebay.com/itm/267826634198'
    );
  });
});
