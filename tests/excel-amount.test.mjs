// Unit test for the Excel import's text-amount parser (app/lib/excelImport.ts).
// Runs the TypeScript source directly via Node's --experimental-strip-types.
import assert from "node:assert/strict";
import test from "node:test";
import { parseAmountText } from "../app/lib/excelImport.ts";

test("excel import: text amounts keep their thousands/decimal meaning", () => {
  const cases = {
    "1.250": 1250, // used to be read as 1.25
    "1,250": 1250,
    "1,250.00": 1250, // used to be read as 1.25
    "1.250,50": 1250.5,
    "12,500,000": 12500000,
    "12,5": 12.5,
    "12.75": 12.75,
    "0,5": 0.5,
    "$1,250": 1250,
    "1 250 TL": 1250,
    "-1.250": -1250,
    "(300)": -300,
    abc: null,
  };
  for (const [input, expected] of Object.entries(cases)) {
    assert.equal(parseAmountText(input), expected, JSON.stringify(input));
  }
});
