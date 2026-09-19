/**
 * The defaults and limits of every query parameter the Worker reads. One place, because
 * the docs site prints them too, and a limit written down twice drifts.
 */
export const LIMIT = { default: 10, max: 50 } as const;
export const RADIUS_KM = { default: 10, max: 100 } as const;
export const PAGE = { default: 1, max: 10_000 } as const;
/** Bounds for min_population and max_population. Casablanca, the largest commune, has 3.2 million. */
export const POPULATION = { max: 10_000_000 } as const;
/** Characters in a search query. The longest name in the dataset is 32, and the cost of a
 * query grows with its length, so an unbounded one could spend the whole CPU budget. */
export const QUERY = { maxLength: 100 } as const;

/** Communes per page on every paginated list, pre-rendered or computed. */
export const PER_PAGE = 50;
