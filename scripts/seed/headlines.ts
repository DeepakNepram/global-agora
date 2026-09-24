/**
 * Invented headlines for the seed, per category. A data table: one row per event.
 *
 * The events are fiction attached to real cities, so they deliberately name no
 * real person, party, company or armed group. The outlets that "report" them
 * are invented too (outlets.ts).
 *
 * `{city}` and `{country}` are filled from the story's place.
 */
import type { NewsCategory } from '../../src/core/nodeBuffer.ts';

export interface HeadlineTemplate {
  readonly title: string;
  /** How a second outlet would headline the same event. */
  readonly alt: string;
  readonly summary: string;
}

type Row = readonly [title: string, alt: string, summary: string];

const ROWS: Readonly<Record<NewsCategory, readonly Row[]>> = {
  world: [
    [
      'Aid convoys reach flood-hit districts outside {city}',
      'Relief supplies arrive in flooded areas near {city}',
      'Relief agencies say roads have reopened to districts outside {city} that were cut off by last week’s floods.',
    ],
    [
      'Thousands gather in {city} for annual harvest festival',
      '{city} harvest festival draws record crowds',
      'Organisers in {city} say attendance is the highest since the festival began, with visitors from across {country}.',
    ],
    [
      'Ferry services resume between {city} and outlying islands',
      'Island ferries back in service after repairs near {city}',
      'Ferry operators near {city} restarted crossings after a month of repairs to the main pier.',
    ],
    [
      'Regional leaders meet in {city} to discuss cross-border rail link',
      'Rail link talks open in {city}',
      'Delegations in {city} are negotiating the route and funding of a proposed cross-border railway.',
    ],
    [
      'Heritage site near {city} reopens after decade-long restoration',
      'Restored landmark near {city} welcomes visitors again',
      'The site near {city} reopened with limited daily tickets while conservation work continues.',
    ],
    [
      'Census shows {city} growing faster than any other city in {country}',
      '{city} leads {country} in population growth',
      'New census figures put {city} ahead of every other city in {country} for growth over the past decade.',
    ],
    [
      'Power restored to most of {city} after overnight outage',
      'Lights back on across {city} after blackout',
      'Utility crews in {city} restored supply to most homes by morning; the cause is under investigation.',
    ],
    [
      '{city} hosts international expo as visitor numbers climb',
      'Expo opens in {city}',
      'The expo in {city} runs for three weeks, and hotels report near-full bookings.',
    ],
  ],
  conflict: [
    [
      'Talks on disputed border crossing resume in {city}',
      'Border crossing talks restart in {city}',
      'Negotiators returned to the table in {city} after talks on the crossing broke down last month.',
    ],
    [
      'Curfew lifted in parts of {city} after week of unrest',
      '{city} eases curfew as calm returns',
      'Authorities in {city} lifted the overnight curfew in several districts after days without incidents.',
    ],
    [
      'Families return to villages near {city} as fighting eases',
      'Displaced families head home near {city}',
      'Aid workers near {city} say hundreds of families have begun returning to villages they left in the spring.',
    ],
    [
      'Demining teams clear farmland outside {city}',
      'Farmers near {city} regain fields as mines are cleared',
      'Demining teams outside {city} say they cleared forty hectares this month, ahead of the planting season.',
    ],
    [
      'Ceasefire monitors report quiet night around {city}',
      'Truce holds overnight near {city}',
      'Monitors stationed around {city} recorded no violations overnight, the third quiet night in a row.',
    ],
    [
      'Prisoner exchange completed at checkpoint near {city}',
      'Detainees swapped near {city}',
      'Both sides confirmed the exchange at a checkpoint near {city}, brokered over several weeks of talks.',
    ],
    [
      'Evacuation corridor opens for civilians near {city}',
      'Civilians leave through corridor near {city}',
      'Humanitarian groups near {city} said buses carried civilians out through the agreed corridor.',
    ],
    [
      'Peace talks in {city} end without agreement',
      'No deal yet as talks in {city} adjourn',
      'Mediators in {city} said the talks would resume next week after the parties failed to agree on a timetable.',
    ],
  ],
  politics: [
    [
      'Parliament in {city} passes budget after late-night session',
      'Budget approved in {city} after marathon debate',
      'Lawmakers in {city} approved the budget in a vote shortly after midnight.',
    ],
    [
      'Early results from {city} point to tight mayoral race',
      '{city} mayoral race too close to call',
      'With most ballots counted in {city}, the two leading candidates are separated by fewer than two points.',
    ],
    [
      'Coalition talks in {city} stall over energy policy',
      'Energy dispute holds up coalition deal in {city}',
      'Negotiators in {city} say they remain apart on energy subsidies, delaying a new government.',
    ],
    [
      'Thousands march in {city} calling for electoral reform',
      'Electoral reform march fills streets of {city}',
      'Marchers in {city} called for changes to how parliamentary seats are allocated in {country}.',
    ],
    [
      'New cabinet sworn in at ceremony in {city}',
      '{country} swears in new cabinet',
      'The new ministers took their oaths in {city} and are expected to hold a first meeting this week.',
    ],
    [
      'Court in {city} hears challenge to new voting-district map',
      'Voting map challenged in {city} court',
      'Judges in {city} heard arguments that the redrawn districts dilute some communities’ votes.',
    ],
    [
      'Anti-corruption bill clears first reading in {city}',
      'Lawmakers in {city} advance anti-graft bill',
      'The bill passed its first reading in {city} and now goes to committee for amendments.',
    ],
    [
      '{city} council approves car ban in historic centre',
      'Historic centre of {city} to go car-free',
      'The council in {city} voted to close the old town to private cars from next spring.',
    ],
  ],
  business: [
    [
      'Shares slide in {city} as markets open lower',
      '{city} stocks fall at the open',
      'Traders in {city} pointed to weaker overnight trading elsewhere as indexes opened lower.',
    ],
    [
      'Port of {city} reports record container traffic',
      'Record month for {city} port',
      'The port authority in {city} said monthly container volumes rose to an all-time high.',
    ],
    [
      'Central bank in {city} holds interest rates steady',
      '{country} leaves rates unchanged',
      'Policymakers in {city} kept the benchmark rate on hold and signalled patience on inflation.',
    ],
    [
      'Battery plant planned outside {city}, with 3,000 jobs',
      'New battery factory to be built near {city}',
      'The planned plant outside {city} would begin production in two years, officials said.',
    ],
    [
      'Dockworkers in {city} end three-day strike after pay deal',
      'Strike ends at {city} docks',
      'Unions in {city} accepted a pay offer, and cargo handling is expected to return to normal by the weekend.',
    ],
    [
      'Startups in {city} raise record funding this quarter',
      '{city} startup funding hits new high',
      'Investors put more money into young companies in {city} this quarter than in any before it.',
    ],
    [
      'Fuel prices in {country} hit six-month high',
      'Drivers in {city} face highest fuel prices since spring',
      'Pump prices in {city} and across {country} rose for the fourth straight week.',
    ],
    [
      'New free-trade zone opens near {city}',
      'Free-trade zone near {city} begins operations',
      'The zone near {city} offers reduced tariffs to manufacturers that export most of their output.',
    ],
  ],
  science: [
    [
      'Aurora lights up skies over {city} after strong solar storm',
      'Northern lights dazzle {city}',
      'A strong geomagnetic storm made the aurora visible over {city} for much of the night.',
    ],
    [
      'Researchers in {city} report new species of deep-sea coral',
      'New coral species described by {city} team',
      'The team in {city} identified the coral from samples collected at depths of over a kilometre.',
    ],
    [
      'Telescope near {city} captures sharpest image yet of distant galaxy',
      'Record-sharp galaxy image from observatory near {city}',
      'Astronomers near {city} say the image resolves star-forming regions never seen before.',
    ],
    [
      'Fossil find near {city} pushes back date of early mammals',
      'Ancient mammal fossil unearthed near {city}',
      'Palaeontologists near {city} say the fossil is several million years older than similar finds.',
    ],
    [
      'University team in {city} unveils low-cost water purifier',
      '{city} researchers build cheap water filter',
      'The filter developed in {city} uses local materials and costs a fraction of commercial units.',
    ],
    [
      'Scientists in {city} map glacier retreat with drone swarm',
      'Drones track shrinking glacier near {city}',
      'Researchers in {city} say the drone survey shows faster retreat than satellite estimates suggested.',
    ],
    [
      'Rocket launch from near {city} puts weather satellite into orbit',
      'Weather satellite launched near {city}',
      'The satellite launched near {city} will improve storm forecasts across the region.',
    ],
    [
      'Ancient shipwreck discovered off the coast near {city}',
      'Divers find old wreck off {city}',
      'Divers off {city} located the wreck in shallow water; its cargo is still being catalogued.',
    ],
  ],
  climate: [
    [
      'Heatwave pushes temperatures in {city} to record high',
      '{city} swelters in record heat',
      'Forecasters in {city} recorded the highest temperature since measurements began.',
    ],
    [
      'Typhoon makes landfall near {city}, thousands evacuated',
      'Thousands evacuated as typhoon hits near {city}',
      'Emergency services near {city} moved thousands of residents to shelters ahead of landfall.',
    ],
    [
      'Drought forces water rationing across {city}',
      '{city} rations water as reservoirs run low',
      'Officials in {city} said reservoirs are below a third of capacity and rationing will continue.',
    ],
    [
      'Wildfire near {city} contained after five days',
      'Firefighters contain blaze near {city}',
      'Crews near {city} contained the fire after it burned through several thousand hectares.',
    ],
    [
      'Floodwaters recede in {city} as clean-up begins',
      '{city} starts clean-up after floods',
      'Residents in {city} began clearing mud from homes as river levels fell.',
    ],
    [
      '{city} unveils plan to plant a million trees',
      'Million-tree plan announced for {city}',
      'The plan in {city} targets neighbourhoods with the least shade and the highest summer temperatures.',
    ],
    [
      'Sea defences in {city} tested by storm surge',
      'Storm surge batters {city} seafront',
      'Engineers in {city} said the new barriers held as the surge peaked at high tide.',
    ],
    [
      'Air quality in {city} improves after traffic restrictions',
      'Cleaner air in {city} since traffic limits',
      'Monitoring stations in {city} show pollution down sharply since the restrictions began.',
    ],
  ],
  tech: [
    [
      'Outage hits payment apps across {city}',
      'Payment apps down in {city}',
      'Shoppers in {city} reported failed card and app payments for several hours.',
    ],
    [
      '{city} launches driverless bus trial on airport route',
      'Driverless buses begin trial in {city}',
      'The trial in {city} runs with a safety driver on board for the first three months.',
    ],
    [
      'Undersea data cable lands at {city}, boosting internet speeds',
      'New subsea cable comes ashore at {city}',
      'Operators say the cable landing at {city} will add capacity for the whole region.',
    ],
    [
      'Chipmaker opens research centre in {city}',
      'New chip research hub for {city}',
      'The centre in {city} will employ several hundred engineers when fully staffed.',
    ],
    [
      'Ransomware attack disrupts city services in {city}',
      'Cyberattack hits public services in {city}',
      'Officials in {city} said permits and payments are offline while systems are restored.',
    ],
    [
      '{city} rolls out free Wi-Fi across transit network',
      'Free Wi-Fi comes to {city} transit',
      'Riders in {city} can now connect at stations and on most buses.',
    ],
    [
      'Satellite internet reaches rural areas near {city}',
      'Villages near {city} get satellite broadband',
      'Schools and clinics near {city} are among the first to be connected.',
    ],
    [
      'Hackathon in {city} draws record entries for disaster-response tools',
      'Disaster-tech hackathon in {city} breaks records',
      'Teams in {city} built tools for flood alerts, shelter mapping and supply tracking.',
    ],
  ],
  health: [
    [
      'Hospitals in {city} report rise in dengue cases',
      'Dengue cases climb in {city}',
      'Doctors in {city} urged residents to clear standing water as admissions rose.',
    ],
    [
      'Vaccination drive reaches remote districts near {city}',
      'Vaccine teams reach remote areas near {city}',
      'Mobile teams near {city} say coverage in remote districts has doubled since spring.',
    ],
    [
      'New children’s hospital opens in {city}',
      '{city} opens children’s hospital',
      'The hospital in {city} adds several hundred beds and a neonatal unit.',
    ],
    [
      'Health officials in {city} track cluster of respiratory infections',
      'Respiratory illness cluster monitored in {city}',
      'Officials in {city} said they are testing samples and advised people with symptoms to stay home.',
    ],
    [
      'Clinics in {city} extend hours as flu season peaks',
      'Flu season stretches clinics in {city}',
      'Clinics in {city} are opening early and closing late to handle a surge in patients.',
    ],
    [
      'Clean-water project cuts cholera cases around {city}',
      'Cholera cases fall near {city} after water project',
      'Health workers around {city} credit new wells and chlorination points for the decline.',
    ],
    [
      'Nurses in {city} vote to accept new staffing agreement',
      'Nurses in {city} approve staffing deal',
      'The agreement in {city} sets minimum nurse-to-patient ratios on hospital wards.',
    ],
    [
      'Study in {city} links green space to lower heart-disease rates',
      'Parks tied to healthier hearts in {city} study',
      'Researchers in {city} followed residents for ten years and found fewer heart problems near parks.',
    ],
  ],
};

const templates = (rows: readonly Row[]): readonly HeadlineTemplate[] =>
  rows.map(([title, alt, summary]): HeadlineTemplate => ({ title, alt, summary }));

export const HEADLINES: Readonly<Record<NewsCategory, readonly HeadlineTemplate[]>> = {
  world: templates(ROWS.world),
  conflict: templates(ROWS.conflict),
  politics: templates(ROWS.politics),
  business: templates(ROWS.business),
  science: templates(ROWS.science),
  climate: templates(ROWS.climate),
  tech: templates(ROWS.tech),
  health: templates(ROWS.health),
};

/** Fills `{city}` and `{country}`. */
export function fillTemplate(text: string, city: string, country: string): string {
  return text.replaceAll('{city}', city).replaceAll('{country}', country);
}
