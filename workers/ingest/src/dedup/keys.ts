/**
 * Event keys: the names, organizations, places and headline words that let two
 * differently worded write-ups be recognized as the same event.
 *
 * The White House press-access ruling of 2026-09-24 ran under ~25 headlines
 * ("Judge orders White House to restore access…", "Judge Temporarily Lifts
 * Trump's White House Media Ban"…) that simhash cannot join. What they share
 * is `p:t kelly` (the judge), `o:cnn`, `w:politico`, `w:judge`. Keys found in
 * a large share of all coverage (`p:d trump`, `o:white house`) say nothing
 * about which event an article is about, and are left out (COMMON_KEYS).
 */

import { COMMON_KEYS } from '../data/common-keys.ts';
import type { IngestArticle } from '../normalize/article.ts';
import { precision } from '../normalize/location.ts';

const MAX_PERSONS = 8;
const MAX_ORGS = 8;
const MAX_WORDS = 10;
const MAX_ORG_LENGTH = 60;

/**
 * Headline words too generic to identify an event, before COMMON_KEYS. Short
 * words are allowed otherwise, because some names are short ("Xi", "Oz").
 */
const STOPWORDS: ReadonlySet<string> = new Set(
  (
    'a about above after again against ago ahead all also am amid among an and another any are ' +
    'around as at away back be been before being below between big both but by can could day ' +
    'did do does doing down during each even ever every few first for from further get go got ' +
    'had has have having he her here him his how if in into is it its just last latest let like ' +
    'live may me more most much must my near new news next no not now of off old on one only or ' +
    'other our out over own per put said saw say says see set she should so some still such than ' +
    'that the their them then there these they this those through to today too top two under ' +
    'until up update updates us use very was way we were what when where which while who why ' +
    'will win with within without won would year years yet you your'
  ).split(' '),
);

const NAME_SUFFIXES: ReadonlySet<string> = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);

/** "timothy j kelly", "tim kelly", "timothy kelly" -> "t kelly". */
export function personKey(name: string): string | null {
  const tokens = name
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token !== '' && !NAME_SUFFIXES.has(token));
  const first = tokens[0];
  const last = tokens.at(-1);
  if (first === undefined || last === undefined) return null;
  if (tokens.length === 1) return `p:${first}`;
  if (last.length < 2) return null;
  return `p:${first[0] ?? ''} ${last}`;
}

/** A crude English stem: plural and possessive "s" only ("trumps" -> "trump"). */
export function stem(word: string): string {
  if (word.length > 5 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

export function titleWordKeys(normalized: string): string[] {
  const keys: string[] = [];
  for (const word of normalized.split(' ')) {
    if (word.length < 2 || STOPWORDS.has(word) || /^\d+$/.test(word)) continue;
    const key = `w:${stem(word)}`;
    if (!keys.includes(key)) keys.push(key);
    if (keys.length === MAX_WORDS) break;
  }
  return keys;
}

/** Person, organization and place keys name the event's actors; words only describe it. */
export function isEntityKey(key: string): boolean {
  return key.startsWith('p:') || key.startsWith('o:') || key.startsWith('l:');
}

/** An article's distinctive event keys. */
export function eventKeys(
  article: IngestArticle,
  common: ReadonlySet<string> = COMMON_KEYS,
): string[] {
  const keys = new Set<string>();

  for (const person of article.persons.slice(0, MAX_PERSONS)) {
    const key = personKey(person);
    if (key !== null) keys.add(key);
  }
  for (const org of article.orgs.slice(0, MAX_ORGS)) {
    const name = org.trim().toLowerCase();
    if (name.length >= 2 && name.length <= MAX_ORG_LENGTH) keys.add(`o:${name}`);
  }
  // Only a city or landmark identifies an event; a state or country is too big.
  if (article.place !== null && precision(article.place.type) === 3) keys.add(article.place.key);
  for (const key of titleWordKeys(article.normalized)) keys.add(key);

  return [...keys].filter((key) => !common.has(key));
}

/** The keys of `keys` that `other` also has. */
export function sharedKeys(keys: Iterable<string>, other: ReadonlySet<string>): string[] {
  const shared: string[] = [];
  for (const key of keys) if (other.has(key)) shared.push(key);
  return shared;
}

/**
 * The merge rule, tuned on the 2026-09-24 feed: two distinctive headline words
 * and at least one person, organization or place in common. Body entities
 * alone over-merge: every Australian Associated Press story carries
 * `o:australian associated` and `o:national news`, which glued a bus crash to
 * a share-market report. Headline words alone are too thin to be sure.
 */
export function sameEvent(shared: readonly string[]): boolean {
  let words = 0;
  let entities = 0;
  for (const key of shared) {
    if (isEntityKey(key)) entities++;
    else words++;
  }
  return words >= 2 && entities >= 1;
}
