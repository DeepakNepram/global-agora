/**
 * GDELT themes -> our fixed categories (NEWS_CATEGORIES in src/core).
 *
 * Every theme below was seen in the live feed on 2026-09-24. Weight 3 means
 * the theme names the category outright (ARMEDCONFLICT, ELECTION,
 * NATURAL_DISASTER_*); 1 means it leans that way but also turns up in
 * unrelated coverage (GENERAL_HEALTH is on about a quarter of all articles).
 * A theme counts once per mention up to its weight, so a weight-1 theme counts
 * once however often it appears: four weak health themes had put a story about
 * computer science graduates in health. TAX_DISEASE_* is left out entirely: it
 * fires on words like "conventional" and "anticipation".
 */

import { NEWS_CATEGORIES, type NewsCategory } from '../../../../src/core/nodeBuffer.ts';

/** Below this average per article, the story is `world`: no category is clear. */
export const MIN_CATEGORY_SCORE = 5;

type Rule = readonly [pattern: string, category: NewsCategory, weight: 1 | 2 | 3];

/** `*` at the end matches a prefix; otherwise the theme must match exactly. */
const RULES: readonly Rule[] = [
  // conflict
  ['ARMEDCONFLICT', 'conflict', 3],
  ['MILITARY', 'conflict', 3],
  ['TERROR', 'conflict', 3],
  ['CEASEFIRE', 'conflict', 3],
  ['TAX_TERROR_GROUP_*', 'conflict', 3],
  ['WB_2462_POLITICAL_VIOLENCE_AND_WAR', 'conflict', 3],
  ['WB_2468_CONVENTIONAL_WAR', 'conflict', 3],
  ['WB_739_POLITICAL_VIOLENCE_AND_CIVIL_WAR', 'conflict', 3],
  ['WB_2510_WAR_CRIMES', 'conflict', 3],
  ['SOC_POINTSOFINTEREST_MILITARY_BASE*', 'conflict', 2],
  ['MILITARY_COOPERATION', 'conflict', 1],
  ['SLFID_MILITARY_*', 'conflict', 1],
  ['TAX_MILITARY_TITLE*', 'conflict', 1],
  ['TAX_WEAPONS_*', 'conflict', 1],
  ['WB_2433_CONFLICT_AND_VIOLENCE', 'conflict', 1],
  ['WB_2470_PEACE_OPERATIONS_AND_CONFLICT_MANAGEMENT', 'conflict', 1],
  // politics
  ['ELECTION', 'politics', 3],
  ['ELECTION_FRAUD', 'politics', 3],
  ['TAX_POLITICAL_PARTY*', 'politics', 3],
  ['IMPEACHMENT', 'politics', 3],
  ['REFERENDUM', 'politics', 3],
  ['LEGISLATION', 'politics', 2],
  ['DEMOCRACY', 'politics', 2],
  ['USPEC_POLITICS_GENERAL1', 'politics', 1],
  ['EPU_POLICY_CONGRESS', 'politics', 1],
  ['EPU_POLICY_GOVERNMENT', 'politics', 1],
  ['GENERAL_GOVERNMENT', 'politics', 1],
  ['LEADER', 'politics', 1],
  ['PROTEST', 'politics', 1],
  ['TAX_FNCACT_PRESIDENT', 'politics', 1],
  ['TAX_FNCACT_PRIME_MINISTER', 'politics', 1],
  ['TAX_FNCACT_MINISTER', 'politics', 1],
  ['UNGP_POLITICAL_FREEDOMS', 'politics', 1],
  ['WB_831_GOVERNANCE', 'politics', 1],
  // business
  ['ECON_STOCKMARKET', 'business', 3],
  ['ECON_INFLATION', 'business', 3],
  ['ECON_INTEREST_RATES', 'business', 3],
  ['ECON_CENTRALBANK', 'business', 3],
  ['ECON_IPO', 'business', 3],
  ['ECON_BANKRUPTCY', 'business', 3],
  ['ECON_WORLDCURRENCIES*', 'business', 1],
  ['ECON_*', 'business', 2],
  ['WB_1104_MACROECONOMIC_VULNERABILITY_AND_DEBT', 'business', 2],
  ['EPU_ECONOMY*', 'business', 1],
  ['TAX_ECON_PRICE', 'business', 1],
  ['WB_1920_FINANCIAL_SECTOR_DEVELOPMENT', 'business', 1],
  ['WB_698_TRADE', 'business', 1],
  ['WB_405_BUSINESS_CLIMATE', 'business', 1],
  ['WB_2670_JOBS', 'business', 1],
  ['ENV_OIL', 'business', 1],
  ['ENV_NATURALGAS', 'business', 1],
  ['ENV_MINING', 'business', 1],
  ['ENV_METALS', 'business', 1],
  ['ENV_COAL', 'business', 1],
  // science
  ['SCIENCE', 'science', 3],
  ['TAX_FNCACT_SCIENTIST', 'science', 3],
  ['TAX_FNCACT_RESEARCHER', 'science', 2],
  // climate: the climate itself, weather, and natural disasters
  ['ENV_CLIMATECHANGE', 'climate', 3],
  ['UNGP_CLIMATE_CHANGE_ACTION', 'climate', 3],
  ['WB_567_CLIMATE_CHANGE', 'climate', 3],
  ['WB_571_CLIMATE_SCIENCE', 'climate', 3],
  ['WB_579_CLIMATE_CHANGE_MITIGATION', 'climate', 3],
  ['WB_1773_CLIMATE_CHANGE_IMPACTS', 'climate', 3],
  ['NATURAL_DISASTER*', 'climate', 3],
  ['CRISISLEX_O01_WEATHER', 'climate', 2],
  ['ENV_GREEN', 'climate', 2],
  ['ENV_SOLAR', 'climate', 2],
  ['ENV_WINDPOWER', 'climate', 2],
  ['ENV_SPECIESENDANGERED', 'climate', 2],
  ['WB_525_RENEWABLE_ENERGY', 'climate', 2],
  ['WB_1791_AIR_POLLUTION', 'climate', 2],
  ['MOVEMENT_ENVIRONMENTAL', 'climate', 2],
  ['ENV_*', 'climate', 1],
  // tech
  ['CYBER_ATTACK', 'tech', 3],
  ['TECH_AUTOMATION', 'tech', 3],
  ['SOC_EMERGINGTECH', 'tech', 3],
  ['SOC_TECHNOLOGYSECTOR', 'tech', 3],
  ['WB_669_SOFTWARE_INFRASTRUCTURE', 'tech', 2],
  ['WB_2381_SOFTWARE_DEVELOPMENT', 'tech', 2],
  ['WB_2416_INTERNET_OF_THINGS', 'tech', 2],
  ['WB_670_ICT_SECURITY', 'tech', 2],
  ['WB_133_INFORMATION_AND_COMMUNICATION_TECHNOLOGIES', 'tech', 1],
  ['WB_652_ICT_APPLICATIONS', 'tech', 1],
  ['WB_376_INNOVATION_TECHNOLOGY_AND_ENTREPRENEURSHIP', 'tech', 1],
  ['SOC_INNOVATION', 'tech', 1],
  // health
  ['HEALTH_PANDEMIC', 'health', 3],
  ['HEALTH_VACCINATION', 'health', 3],
  ['WB_2167_PANDEMICS', 'health', 3],
  ['WB_1406_DISEASES', 'health', 2],
  ['WB_1415_COMMUNICABLE_DISEASE', 'health', 2],
  ['WB_1350_PHARMACEUTICALS', 'health', 2],
  ['WB_635_PUBLIC_HEALTH', 'health', 2],
  ['WB_2165_HEALTH_EMERGENCIES', 'health', 2],
  ['WB_1430_MENTAL_HEALTH', 'health', 2],
  ['WB_1431_CANCER', 'health', 2],
  ['EPU_CATS_HEALTHCARE', 'health', 2],
  ['UNGP_HEALTHCARE', 'health', 2],
  ['GENERAL_HEALTH', 'health', 1],
  ['MEDICAL', 'health', 1],
  ['WB_621_HEALTH_NUTRITION_AND_POPULATION', 'health', 1],
  ['CRISISLEX_C03_WELLBEING_HEALTH', 'health', 1],
];

/** The first matching rule wins, so specific rules sit above their prefix. */
function ruleFor(theme: string): Rule | undefined {
  return RULES.find(([pattern]) =>
    pattern.endsWith('*') ? theme.startsWith(pattern.slice(0, -1)) : theme === pattern,
  );
}

const CATEGORY_INDEX = new Map<NewsCategory, number>(NEWS_CATEGORIES.map((c, i) => [c, i]));

/** Per-category scores for one article, indexed like NEWS_CATEGORIES. */
export function categoryScores(themes: ReadonlyMap<string, number>): number[] {
  const scores = NEWS_CATEGORIES.map(() => 0);
  for (const [theme, mentions] of themes) {
    const rule = ruleFor(theme);
    if (rule === undefined) continue;
    const index = CATEGORY_INDEX.get(rule[1]) ?? 0;
    const weight = rule[2];
    scores[index] = (scores[index] ?? 0) + weight * Math.min(mentions, weight);
  }
  return scores;
}

/**
 * The category index for summed scores over `articles` articles: the highest
 * scoring category if its average clears the bar, else 0 (`world`).
 */
export function pickCategory(scores: readonly number[], articles: number): number {
  let best = 0;
  let bestScore = 0;
  scores.forEach((score, i) => {
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return articles > 0 && bestScore / articles >= MIN_CATEGORY_SCORE ? best : 0;
}
