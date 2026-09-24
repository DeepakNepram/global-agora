/**
 * Invented outlets for the seed articles.
 *
 * Made-up names on the reserved `.example` top-level domain (RFC 2606), so no
 * seeded link can lead to, or be mistaken for, a real publication.
 */

export interface Outlet {
  readonly name: string;
  readonly domain: string;
  /** ISO 3166-1 alpha-2. */
  readonly country: string;
}

type OutletRow = readonly [name: string, country: string];

const OUTLET_ROWS: readonly OutletRow[] = [
  ['Harbor Ledger', 'GB'],
  ['Meridian Wire', 'US'],
  ['Northline Post', 'CA'],
  ['Southern Cross Herald', 'AU'],
  ['Lagoon Times', 'NG'],
  ['Savanna Daily', 'KE'],
  ['Monsoon Courier', 'IN'],
  ['Kestrel News', 'IE'],
  ['Cedar Tribune', 'LB'],
  ['Andes Chronicle', 'PE'],
  ['Pampas Gazette', 'AR'],
  ['Delta Dispatch', 'EG'],
  ['Pacific Lantern', 'JP'],
  ['Strait Observer', 'SG'],
  ['Tasman Record', 'NZ'],
  ['Baltic Signal', 'SE'],
  ['Danube Review', 'AT'],
  ['Atlas Bulletin', 'MA'],
  ['Highveld Mirror', 'ZA'],
  ['Sierra Journal', 'MX'],
  ['Caribbean Current', 'JM'],
  ['Steppe Standard', 'KZ'],
  ['Coral Sea Times', 'FJ'],
  ['Rhine Report', 'DE'],
];

export const OUTLETS: readonly Outlet[] = OUTLET_ROWS.map(([name, country]): Outlet => ({
  name,
  country,
  domain: `${name.toLowerCase().replaceAll(' ', '-')}.example`,
}));
