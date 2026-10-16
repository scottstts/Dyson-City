/**
 * The estate's terrace level (city_plan §4 "The estate"): one raised bed of soil, flat, 1.6 m above
 * the pad, held by a retaining wall all round. The house stands on it (its grade is the terrace).
 * The drive ramps down to the pad through the gateway. Heights in world metres.
 */
import { PAD_HEIGHT } from '../ground/site';

/** The terrace's soil level: the house's grade and the base of every garden surface. */
export const TERRACE_Y = PAD_HEIGHT + 1.6;
/** The house's grade (its origin: grade under the front door). */
export const HOUSE_GRADE = TERRACE_Y;
