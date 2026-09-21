/**
 * Every /api path that isn't a file. The static files, all of them .json or .geojson, are
 * excluded in _routes.json, so Pages serves them without running this, and they stay free
 * and unmetered. What is left is the live tier: search, the point and radius lookups, the
 * filtered lists and the aliases that turn a slug into its file.
 */
export { onRequest } from "../../api/src/worker/pages.ts";
