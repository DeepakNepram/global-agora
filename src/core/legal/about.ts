import { contactPhrase } from './site';
import type { LegalDocument, LegalSite } from './types';

/** What Global Agora is, where its news comes from, and who to credit. */
export function aboutDocument(site: LegalSite): LegalDocument {
  return {
    id: 'about',
    title: 'About Global Agora',
    summary:
      'The world’s news on a living Earth: where each story is happening, how widely it is ' +
      'covered, and how it spread over the last day, with structured debates on the biggest.',
    sections: [
      {
        id: 'news',
        title: 'Where the news comes from',
        paragraphs: [
          'The stories come from the GDELT Project (https://www.gdeltproject.org), which ' +
            'monitors news outlets around the world and is free for anyone to use with credit. ' +
            'Global Agora groups its articles into stories, places each one on the map, and links ' +
            'to the outlets’ own pages.',
          'We show a headline, a short snippet and a link. We never copy or store the articles ' +
            'themselves: to read a story, you go to the outlet that published it.',
          'Places and categories are worked out automatically and can be wrong. Every story has a ' +
            'way to report a wrong location.',
        ],
      },
      {
        id: 'debates',
        title: 'Debates',
        paragraphs: [
          'A few of the biggest stories open for debate around a single question. Each person ' +
            'takes a side, and posts are checked against the community rules before others see ' +
            'them. Readers can mark a post as helpful or as having changed their mind, and a ' +
            'mark from someone on the other side counts for more.',
        ],
      },
      {
        id: 'alpha',
        title: 'An invite-only alpha',
        paragraphs: [
          'Anyone with the link can read the news. Accounts, which you need to take part in ' +
            'debates and to keep your follows and saved stories on every device, are by ' +
            'invitation while we test.',
          `Things will change, and some will break. When they do, please ${contactPhrase(site)}.`,
        ],
      },
      {
        id: 'credits',
        title: 'Credits',
        paragraphs: ['Global Agora is built on open data and free imagery:'],
        items: [
          'News: the GDELT Project.',
          'The Earth by day: NASA Earth Observatory, Blue Marble: Next Generation (Reto Stöckli).',
          'The Earth at night: NASA Earth Observatory, Black Marble (Suomi NPP VIIRS).',
          'Clouds: NASA Earth Observatory, Blue Marble cloud composite.',
          'Cities and countries for search: Natural Earth.',
          'NASA’s imagery is used under its media policy; NASA does not endorse Global Agora.',
        ],
      },
    ],
  };
}
