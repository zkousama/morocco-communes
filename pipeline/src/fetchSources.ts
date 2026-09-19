/**
 * Downloads HCP's workbooks into .cache and checks each against its pinned digest, without
 * building anything. The tests read the workbooks from there, and CI starts without them.
 */
import { fetchAll } from "./fetch.ts";

const sources = await fetchAll(".cache");
console.log(`fetched ${sources.size} workbooks into .cache`);
