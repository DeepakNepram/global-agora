/**
 * Real cities for the fictional seed stories, weighted roughly by how often
 * each appears in world news, so the seeded globe is dense where real
 * coverage is dense and still reaches every inhabited continent.
 *
 * Coordinates are city centres to two decimals (about 1 km), which is the
 * precision GDELT itself places stories at.
 */

export type Region =
  | 'africa'
  | 'antarctica'
  | 'asia'
  | 'europe'
  | 'middle-east'
  | 'north-america'
  | 'oceania'
  | 'south-america';

export interface Place {
  readonly city: string;
  readonly country: string;
  /** ISO 3166-1 alpha-2. */
  readonly code: string;
  readonly lat: number;
  readonly lon: number;
  readonly region: Region;
  /** Relative chance of a random story landing here. */
  readonly weight: number;
}

type Row = readonly [string, string, string, number, number, Region, number];

const ROWS: readonly Row[] = [
  // Europe
  ['London', 'United Kingdom', 'GB', 51.51, -0.13, 'europe', 3],
  ['Paris', 'France', 'FR', 48.86, 2.35, 'europe', 3],
  ['Berlin', 'Germany', 'DE', 52.52, 13.4, 'europe', 2],
  ['Frankfurt', 'Germany', 'DE', 50.11, 8.68, 'europe', 1],
  ['Madrid', 'Spain', 'ES', 40.42, -3.7, 'europe', 2],
  ['Rome', 'Italy', 'IT', 41.9, 12.5, 'europe', 2],
  ['Brussels', 'Belgium', 'BE', 50.85, 4.35, 'europe', 2],
  ['Amsterdam', 'Netherlands', 'NL', 52.37, 4.9, 'europe', 1],
  ['Warsaw', 'Poland', 'PL', 52.23, 21.01, 'europe', 1],
  ['Kyiv', 'Ukraine', 'UA', 50.45, 30.52, 'europe', 2],
  ['Stockholm', 'Sweden', 'SE', 59.33, 18.07, 'europe', 1],
  ['Athens', 'Greece', 'GR', 37.98, 23.73, 'europe', 1],
  ['Lisbon', 'Portugal', 'PT', 38.72, -9.14, 'europe', 1],
  ['Dublin', 'Ireland', 'IE', 53.35, -6.26, 'europe', 1],
  ['Vienna', 'Austria', 'AT', 48.21, 16.37, 'europe', 1],
  ['Bucharest', 'Romania', 'RO', 44.43, 26.1, 'europe', 1],
  ['Reykjavík', 'Iceland', 'IS', 64.15, -21.94, 'europe', 1],
  ['Tromsø', 'Norway', 'NO', 69.65, 18.96, 'europe', 1],
  ['Istanbul', 'Türkiye', 'TR', 41.01, 28.98, 'europe', 2],
  ['Ankara', 'Türkiye', 'TR', 39.93, 32.86, 'middle-east', 1],
  // Middle East
  ['Riyadh', 'Saudi Arabia', 'SA', 24.71, 46.68, 'middle-east', 1],
  ['Dubai', 'United Arab Emirates', 'AE', 25.2, 55.27, 'middle-east', 2],
  ['Doha', 'Qatar', 'QA', 25.29, 51.53, 'middle-east', 1],
  ['Tehran', 'Iran', 'IR', 35.69, 51.39, 'middle-east', 1],
  ['Amman', 'Jordan', 'JO', 31.95, 35.93, 'middle-east', 1],
  ['Beirut', 'Lebanon', 'LB', 33.89, 35.5, 'middle-east', 1],
  ['Baghdad', 'Iraq', 'IQ', 33.31, 44.36, 'middle-east', 1],
  // Africa
  ['Cairo', 'Egypt', 'EG', 30.04, 31.24, 'africa', 2],
  ['Lagos', 'Nigeria', 'NG', 6.52, 3.38, 'africa', 2],
  ['Abuja', 'Nigeria', 'NG', 9.06, 7.5, 'africa', 1],
  ['Nairobi', 'Kenya', 'KE', -1.29, 36.82, 'africa', 2],
  ['Addis Ababa', 'Ethiopia', 'ET', 9.03, 38.74, 'africa', 1],
  ['Johannesburg', 'South Africa', 'ZA', -26.2, 28.05, 'africa', 2],
  ['Cape Town', 'South Africa', 'ZA', -33.92, 18.42, 'africa', 1],
  ['Accra', 'Ghana', 'GH', 5.6, -0.19, 'africa', 1],
  ['Dakar', 'Senegal', 'SN', 14.72, -17.47, 'africa', 1],
  ['Kinshasa', 'DR Congo', 'CD', -4.44, 15.27, 'africa', 1],
  ['Khartoum', 'Sudan', 'SD', 15.5, 32.56, 'africa', 1],
  ['Casablanca', 'Morocco', 'MA', 33.57, -7.59, 'africa', 1],
  ['Tunis', 'Tunisia', 'TN', 36.81, 10.18, 'africa', 1],
  ['Dar es Salaam', 'Tanzania', 'TZ', -6.79, 39.21, 'africa', 1],
  ['Kampala', 'Uganda', 'UG', 0.35, 32.58, 'africa', 1],
  ['Abidjan', "Côte d'Ivoire", 'CI', 5.36, -4.01, 'africa', 1],
  ['Luanda', 'Angola', 'AO', -8.84, 13.23, 'africa', 1],
  ['Antananarivo', 'Madagascar', 'MG', -18.88, 47.51, 'africa', 1],
  ["N'Djamena", 'Chad', 'TD', 12.13, 15.06, 'africa', 1],
  // Asia
  ['Tokyo', 'Japan', 'JP', 35.68, 139.69, 'asia', 3],
  ['Osaka', 'Japan', 'JP', 34.69, 135.5, 'asia', 1],
  ['Seoul', 'South Korea', 'KR', 37.57, 126.98, 'asia', 2],
  ['Beijing', 'China', 'CN', 39.9, 116.41, 'asia', 2],
  ['Shanghai', 'China', 'CN', 31.23, 121.47, 'asia', 2],
  ['Xiamen', 'China', 'CN', 24.48, 118.09, 'asia', 1],
  ['Hong Kong', 'China', 'HK', 22.32, 114.17, 'asia', 2],
  ['Taipei', 'Taiwan', 'TW', 25.03, 121.57, 'asia', 1],
  ['Kaohsiung', 'Taiwan', 'TW', 22.63, 120.3, 'asia', 1],
  ['Manila', 'Philippines', 'PH', 14.6, 120.98, 'asia', 2],
  ['Jakarta', 'Indonesia', 'ID', -6.21, 106.85, 'asia', 2],
  ['Singapore', 'Singapore', 'SG', 1.35, 103.82, 'asia', 2],
  ['Bangkok', 'Thailand', 'TH', 13.76, 100.5, 'asia', 2],
  ['Hanoi', 'Vietnam', 'VN', 21.03, 105.85, 'asia', 1],
  ['Ho Chi Minh City', 'Vietnam', 'VN', 10.82, 106.63, 'asia', 1],
  ['Kuala Lumpur', 'Malaysia', 'MY', 3.14, 101.69, 'asia', 1],
  ['Mumbai', 'India', 'IN', 19.08, 72.88, 'asia', 3],
  ['New Delhi', 'India', 'IN', 28.61, 77.21, 'asia', 3],
  ['Bengaluru', 'India', 'IN', 12.97, 77.59, 'asia', 2],
  ['Kolkata', 'India', 'IN', 22.57, 88.36, 'asia', 1],
  ['Chennai', 'India', 'IN', 13.08, 80.27, 'asia', 1],
  ['Dhaka', 'Bangladesh', 'BD', 23.81, 90.41, 'asia', 1],
  ['Karachi', 'Pakistan', 'PK', 24.86, 67.01, 'asia', 1],
  ['Kathmandu', 'Nepal', 'NP', 27.72, 85.32, 'asia', 1],
  ['Colombo', 'Sri Lanka', 'LK', 6.93, 79.86, 'asia', 1],
  ['Almaty', 'Kazakhstan', 'KZ', 43.24, 76.89, 'asia', 1],
  ['Ulaanbaatar', 'Mongolia', 'MN', 47.89, 106.91, 'asia', 1],
  // Oceania
  ['Sydney', 'Australia', 'AU', -33.87, 151.21, 'oceania', 2],
  ['Melbourne', 'Australia', 'AU', -37.81, 144.96, 'oceania', 1],
  ['Brisbane', 'Australia', 'AU', -27.47, 153.03, 'oceania', 1],
  ['Perth', 'Australia', 'AU', -31.95, 115.86, 'oceania', 1],
  ['Hobart', 'Australia', 'AU', -42.88, 147.33, 'oceania', 1],
  ['Auckland', 'New Zealand', 'NZ', -36.85, 174.76, 'oceania', 1],
  ['Suva', 'Fiji', 'FJ', -18.14, 178.44, 'oceania', 1],
  ['Port Moresby', 'Papua New Guinea', 'PG', -9.44, 147.18, 'oceania', 1],
  // North America
  ['New York', 'United States', 'US', 40.71, -74.01, 'north-america', 3],
  ['Washington', 'United States', 'US', 38.91, -77.04, 'north-america', 3],
  ['Los Angeles', 'United States', 'US', 34.05, -118.24, 'north-america', 2],
  ['San Francisco', 'United States', 'US', 37.77, -122.42, 'north-america', 2],
  ['Seattle', 'United States', 'US', 47.61, -122.33, 'north-america', 1],
  ['Chicago', 'United States', 'US', 41.88, -87.63, 'north-america', 1],
  ['Houston', 'United States', 'US', 29.76, -95.37, 'north-america', 1],
  ['Miami', 'United States', 'US', 25.76, -80.19, 'north-america', 1],
  ['Anchorage', 'United States', 'US', 61.22, -149.9, 'north-america', 1],
  ['Toronto', 'Canada', 'CA', 43.65, -79.38, 'north-america', 2],
  ['Vancouver', 'Canada', 'CA', 49.28, -123.12, 'north-america', 1],
  ['Montréal', 'Canada', 'CA', 45.5, -73.57, 'north-america', 1],
  ['Mexico City', 'Mexico', 'MX', 19.43, -99.13, 'north-america', 2],
  ['Guatemala City', 'Guatemala', 'GT', 14.63, -90.51, 'north-america', 1],
  ['Havana', 'Cuba', 'CU', 23.11, -82.37, 'north-america', 1],
  ['Port-au-Prince', 'Haiti', 'HT', 18.59, -72.31, 'north-america', 1],
  ['Panama City', 'Panama', 'PA', 8.98, -79.52, 'north-america', 1],
  // South America
  ['São Paulo', 'Brazil', 'BR', -23.55, -46.63, 'south-america', 2],
  ['Rio de Janeiro', 'Brazil', 'BR', -22.91, -43.17, 'south-america', 1],
  ['Brasília', 'Brazil', 'BR', -15.79, -47.88, 'south-america', 1],
  ['Manaus', 'Brazil', 'BR', -3.12, -60.02, 'south-america', 1],
  ['Buenos Aires', 'Argentina', 'AR', -34.6, -58.38, 'south-america', 2],
  ['Santiago', 'Chile', 'CL', -33.45, -70.67, 'south-america', 1],
  ['Lima', 'Peru', 'PE', -12.05, -77.04, 'south-america', 1],
  ['Bogotá', 'Colombia', 'CO', 4.71, -74.07, 'south-america', 1],
  ['Caracas', 'Venezuela', 'VE', 10.48, -66.9, 'south-america', 1],
  ['Quito', 'Ecuador', 'EC', -0.18, -78.47, 'south-america', 1],
  ['La Paz', 'Bolivia', 'BO', -16.49, -68.12, 'south-america', 1],
  ['Montevideo', 'Uruguay', 'UY', -34.9, -56.16, 'south-america', 1],
  // Antarctica: rare, but the globe should have a pin at the bottom too.
  ['McMurdo Station', 'Antarctica', 'AQ', -77.85, 166.67, 'antarctica', 0.5],
];

export const PLACES: readonly Place[] = ROWS.map(
  ([city, country, code, lat, lon, region, weight]): Place => ({
    city,
    country,
    code,
    lat,
    lon,
    region,
    weight,
  }),
);

export function placeNamed(city: string): Place {
  const place = PLACES.find((candidate) => candidate.city === city);
  if (place === undefined) throw new Error(`seed: no place named ${city}`);
  return place;
}

/** The label shown under a pin, in the payload's `pl` format: "Ankara, Türkiye". */
export function placeLabel(place: Place): string {
  return place.city === place.country ? place.city : `${place.city}, ${place.country}`;
}
