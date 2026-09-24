/**
 * Once a night: the last week's rows become counts in `daily`, and anything past 90 days
 * leaves `events`. The retention promise keeps itself here, rather than waiting for
 * somebody to run a command.
 *
 * The SQL goes through prepare() in one batch. D1's exec() splits its input on newlines,
 * so a statement written across lines can't pass through it.
 */
import { KEEP_DAYS, PRUNE, ROLLUP } from "./sql.ts";

/** Each night counts the 7 days before it again, so a night that doesn't run is caught up on the next. */
const WINDOW = 7;

const dayBefore = (now: number, days: number): string =>
  new Date(now - days * 86_400_000).toISOString().slice(0, 10);

export default {
  async scheduled(controller: ScheduledController, env: { DEMAND: D1Database }, _ctx: ExecutionContext) {
    const now = controller.scheduledTime;
    const days = Array.from({ length: WINDOW }, (_, i) => dayBefore(now, i + 1));
    await env.DEMAND.batch([
      ...days.map((day) => env.DEMAND.prepare(ROLLUP).bind(day)),
      env.DEMAND.prepare(PRUNE).bind(dayBefore(now, KEEP_DAYS)),
    ]);
  },
};
