/**
 * Once a night: yesterday's rows become counts in `daily`, and anything past 90 days
 * leaves `events`. The retention promise keeps itself here, rather than waiting for
 * somebody to run a command.
 */
const KEY = "day, kind, text, code, locale, country, via, via_site, bot";

export const rollupSql = (day: string): string =>
  `INSERT INTO daily (${KEY}, n)
   SELECT ${KEY}, COUNT(*) FROM events WHERE day = '${day}' GROUP BY ${KEY}
   ON CONFLICT(${KEY}) DO UPDATE SET n = excluded.n;`;

export const pruneSql = (before: string): string => `DELETE FROM events WHERE day < '${before}';`;

const dayBefore = (now: Date, days: number): string =>
  new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);

export default {
  async scheduled(_event: ScheduledController, env: { DEMAND: D1Database }, _ctx: ExecutionContext) {
    const now = new Date();
    await env.DEMAND.exec(rollupSql(dayBefore(now, 1)));
    await env.DEMAND.exec(pruneSql(dayBefore(now, 90)));
  },
};
