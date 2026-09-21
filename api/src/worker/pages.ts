/**
 * The app as a Cloudflare Pages function. Pages passes an EventContext rather than a
 * Worker's ExecutionContext, so the parts the app can use are handed on under the names it
 * expects.
 */
import app from "./index.ts";

export const onRequest: PagesFunction<{ ASSETS: Fetcher }> = (context) =>
  app.fetch(context.request, context.env, {
    waitUntil: (promise: Promise<unknown>) => context.waitUntil(promise),
    passThroughOnException: () => context.passThroughOnException(),
    props: {},
  });
