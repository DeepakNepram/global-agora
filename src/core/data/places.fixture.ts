/** A small places file in the shape scripts/places/build.ts writes. */
export function samplePlacesJson(): Record<string, unknown> {
  // Ids: 1159151609 Tokyo, 1159151621 São Paulo, 1159151189 Hargeisa, 1159151700 Yokohama.
  const ids = [1159151189, 1159151609, 1159151621, 1159151700];
  return {
    v: 1,
    source: 'test',
    countries: {
      code: ['BR', 'JP', 'US'],
      name: ['Brazil', 'Japan', 'United States of America'],
      aliases: ['', '', 'United States,USA'],
      lat: [-1060, 3650, 3954],
      lon: [-5370, 13840, -9748],
      radius: [245, 97, 231],
    },
    cities: {
      idDelta: ids.map((id, i) => id - (ids[i - 1] ?? 0)),
      name: ['Hargeisa', 'Tokyo', 'São Paulo', 'Yokohama'],
      ascii: ['Hargeysa', '', 'Sao Paulo', ''],
      country: ['~Somaliland', 'JP', 'BR', 'JP'],
      lat: [956, 3569, -2356, 3545],
      lon: [4407, 13975, -4663, 13963],
      population: [480000, 36000000, 19000000, 3700000],
    },
  };
}
