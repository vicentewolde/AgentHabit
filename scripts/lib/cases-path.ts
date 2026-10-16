import { resolve } from "node:path";

/** Where the case table lands for the contract runners (A-3). Writing here is not P-2's bridge. */
export const CASES_PATH = resolve(import.meta.dirname, "../../contracts/fixtures/cases.json");
