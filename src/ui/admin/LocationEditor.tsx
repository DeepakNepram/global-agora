import { useEffect, useId, useMemo, useRef, useState, type JSX } from 'react';

import { indexPlaces, search, type PlaceResult } from '@/core';
import {
  countryCodeValid,
  useLocationsStore,
  type LocationsController,
} from '@/state/adminLocations';

import { INPUT, LABEL, PRIMARY, QUIET } from '../account/accountStyles';
import { formatLatLon } from './adminView';
import { LocationMap } from './LocationMap';

export interface LocationEditorProps {
  readonly controller: LocationsController;
}

function chosen(result: PlaceResult): { name: string; countryCode: string } {
  if (result.city !== null) return { name: result.city.name, countryCode: result.city.countryCode };
  if (result.country !== null)
    return { name: result.country.name, countryCode: result.country.code };
  return { name: result.label, countryCode: '' };
}

function parseCoordinate(text: string, limit: number): number | null {
  const value = Number(text);
  return text.trim() !== '' && Number.isFinite(value) && Math.abs(value) <= limit ? value : null;
}

/**
 * One story's pin, moved: by clicking the map, by a place search (the
 * gazetteer, which also names it), or by typing the coordinates. The name
 * follows the pin until it is typed over.
 */
export function LocationEditor({ controller }: LocationEditorProps): JSX.Element | null {
  const id = useId();
  const selected = useLocationsStore((state) => state.selected);
  const pin = useLocationsStore((state) => state.pin);
  const placeName = useLocationsStore((state) => state.placeName);
  const countryCode = useLocationsStore((state) => state.countryCode);
  const saving = useLocationsStore((state) => state.saving);
  const places = useLocationsStore((state) => state.places);
  const [query, setQuery] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const storyId = selected?.storyId ?? null;

  // Opening it (above the list) takes focus there, so the keyboard does not
  // have to find its way back up (Prompt 5.1).
  useEffect(() => {
    if (storyId !== null) heading.current?.focus();
  }, [storyId]);
  const index = useMemo(() => (places === null ? null : indexPlaces(places)), [places]);
  const results = useMemo(
    () =>
      index === null
        ? []
        : search({ places: index, stories: null, nodes: null, outlets: null }, query, 0).places,
    [index, query],
  );

  if (selected === null || pin === null) return null;
  const was = { lat: selected.lat, lon: selected.lon };
  const countryOk = countryCodeValid(countryCode);

  return (
    <section
      aria-label={`Move the pin of “${selected.title}”`}
      className="flex flex-col gap-3 rounded-lg border border-accent/40 p-3"
    >
      <div>
        <h3 ref={heading} tabIndex={-1} className="text-sm font-semibold text-ink outline-none">
          {selected.title}
        </h3>
        <p className="text-xs text-muted">
          Now: {selected.placeName ?? 'no place'}
          {selected.countryCode !== null && ` [${selected.countryCode}]`} (
          {selected.placeSource ?? 'unknown'}), {formatLatLon(selected.lat, selected.lon)}
        </p>
      </div>

      <div>
        <label htmlFor={`${id}-search`} className={LABEL}>
          Find a place
        </label>
        <input
          id={`${id}-search`}
          type="search"
          value={query}
          placeholder={places === null ? 'Loading places…' : 'City or country'}
          disabled={places === null || saving}
          onChange={(event) => setQuery(event.target.value)}
          className={INPUT}
        />
        {results.length > 0 && (
          <ul aria-label="Places" className="mt-1 flex flex-col">
            {results.map((result) => (
              <li key={result.key}>
                <button
                  type="button"
                  className="w-full rounded px-3 py-1.5 text-left text-sm text-ink hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  onClick={() => {
                    controller.placeAt({ lat: result.lat, lon: result.lon, ...chosen(result) });
                    setQuery('');
                  }}
                >
                  {result.label} <span className="text-xs text-muted">{result.detail}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <LocationMap key={selected.storyId} pin={pin} was={was} onPick={controller.movePin} />

      <div className="grid grid-cols-2 gap-2">
        {(['lat', 'lon'] as const).map((axis) => (
          <div key={axis}>
            <label htmlFor={`${id}-${axis}`} className={LABEL}>
              {axis === 'lat' ? 'Latitude (−90 to 90)' : 'Longitude (−180 to 180)'}
            </label>
            <input
              // Re-keyed by the pin, so a click on the map rewrites the field.
              key={`${axis}:${pin[axis]}`}
              id={`${id}-${axis}`}
              type="number"
              step="0.0001"
              defaultValue={pin[axis].toFixed(4)}
              disabled={saving}
              onBlur={(event) => {
                const value = parseCoordinate(event.target.value, axis === 'lat' ? 90 : 180);
                if (value !== null) controller.movePin({ ...pin, [axis]: value });
              }}
              className={INPUT}
            />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[1fr_6rem] gap-2">
        <div>
          <label htmlFor={`${id}-place`} className={LABEL}>
            Place name (shown on the story)
          </label>
          <input
            id={`${id}-place`}
            type="text"
            maxLength={120}
            value={placeName}
            disabled={saving}
            onChange={(event) => controller.editPlace('placeName', event.target.value)}
            className={INPUT}
          />
        </div>
        <div>
          <label htmlFor={`${id}-country`} className={LABEL}>
            Country
          </label>
          <input
            id={`${id}-country`}
            type="text"
            value={countryCode}
            placeholder="IN"
            disabled={saving}
            aria-invalid={!countryOk}
            aria-describedby={countryOk ? undefined : `${id}-country-problem`}
            onChange={(event) => controller.editPlace('countryCode', event.target.value)}
            className={INPUT}
          />
        </div>
      </div>
      {!countryOk && (
        <p id={`${id}-country-problem`} role="alert" className="text-sm text-red-300">
          The country is a two-letter code (IN, FR), or empty.
        </p>
      )}

      <p className="text-xs text-muted">Moving to {formatLatLon(pin.lat, pin.lon)}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={PRIMARY}
          disabled={saving || !countryOk}
          onClick={() => void controller.save()}
        >
          {saving ? 'Moving…' : 'Move the pin here'}
        </button>
        <button type="button" className={QUIET} disabled={saving} onClick={controller.cancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}
