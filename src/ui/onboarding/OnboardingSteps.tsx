import { useEffect, useRef, type JSX } from 'react';

import { CATEGORY_LABELS, NEWS_CATEGORIES } from '@/core';
import { followsStore, onboardingStore, useFollowsStore, useOnboardingStore } from '@/state';

import { categoryFollow } from '../library/followInputs';
import { PlacePicker } from '../library/PlacePicker';
import type { GlobeTarget } from '../nav/globeNavigation';
import { flyHome } from './flyHome';

const CHIP =
  'flex h-10 items-center rounded-full border px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const LINK =
  'rounded text-sm text-accent underline underline-offset-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

/** Step 1: interests. Each choice is a followed category at once, so Skip keeps it. */
export function InterestsStep(): JSX.Element {
  const follows = useFollowsStore((state) => state.follows);
  return (
    <>
      <p className="text-sm text-ink/80">
        Pick any topics. Their stories collect in your Following tab, and you can change them there
        any time.
      </p>
      <div role="group" aria-label="Topics to follow" className="flex flex-wrap gap-2">
        {NEWS_CATEGORIES.map((category) => {
          const on = follows.some((f) => f.kind === 'category' && f.target === category);
          return (
            <button
              key={category}
              type="button"
              aria-pressed={on}
              onClick={() => followsStore.getState().toggle(categoryFollow(category))}
              className={
                on
                  ? `${CHIP} border-ink/60 bg-ink text-void`
                  : `${CHIP} border-ink/20 text-ink hover:bg-white/10`
              }
            >
              {CATEGORY_LABELS[category]}
            </button>
          );
        })}
      </div>
    </>
  );
}

/**
 * Step 2: home city. Typed, never located: no location permission and no IP
 * guess. It decides where the globe rests, and stays on this device.
 */
export function HomeStep({ target }: { target: GlobeTarget }): JSX.Element {
  const home = useOnboardingStore((state) => state.homeCity);
  const change = useRef<HTMLButtonElement>(null);
  const chosen = useRef(false);
  // Choosing replaces the field it was typed in: focus moves on to Change.
  useEffect(() => {
    if (home && chosen.current) change.current?.focus();
    chosen.current = false;
  }, [home]);
  return (
    <>
      <p className="text-sm text-ink/80">
        The globe will open over your home city, and the Home key brings you back to it. It stays on
        this device; we never ask where you are.
      </p>
      {home ? (
        <p className="flex flex-wrap items-center gap-3 text-sm text-ink">
          Home: <strong className="font-semibold">{home.label}</strong>
          <button
            ref={change}
            type="button"
            className={LINK}
            aria-label={`Change home city, now ${home.label}`}
            onClick={() => onboardingStore.getState().setHomeCity(null)}
          >
            Change
          </button>
        </p>
      ) : (
        <PlacePicker
          label="Home city"
          placeholder="Type a city"
          citiesOnly
          onChoose={(place) => {
            if (!place.city) return;
            const city = {
              id: place.city.id,
              label: `${place.city.name}, ${place.city.countryName}`,
              lat: place.city.lat,
              lon: place.city.lon,
            };
            chosen.current = true;
            onboardingStore.getState().setHomeCity(city);
            flyHome(target, city);
          }}
        />
      )}
    </>
  );
}

/** Step 3: alerts. The answer is recorded; nothing is sent until alerts exist. */
export function AlertsStep({ onAnswer }: { onAnswer: (on: boolean) => void }): JSX.Element {
  return (
    <>
      <p className="text-sm text-ink/80">
        Want to hear about big stories in the places and topics you follow?
      </p>
      <p className="text-xs text-muted">
        Alerts are not switched on yet. We will remember your answer, and ask your browser for
        permission only when they are.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onAnswer(true)}
          className={`${CHIP} border-accent bg-accent text-void hover:bg-accent/90`}
        >
          Yes, alert me
        </button>
        <button
          type="button"
          onClick={() => onAnswer(false)}
          className={`${CHIP} border-ink/20 text-ink hover:bg-white/10`}
        >
          Not now
        </button>
      </div>
    </>
  );
}
