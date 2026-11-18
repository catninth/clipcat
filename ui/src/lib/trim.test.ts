import { expect, it } from "vitest";
import { canTrim, clampEnd, clampStart, isWholeClip } from "./trim";

it("keeps at least one second between the handles", () => {
  expect(clampStart(9.5, 10)).toBe(9);
  expect(clampEnd(2.5, 2, 13)).toBe(3);
});

it("keeps the handles inside the clip", () => {
  expect(clampStart(-3, 10)).toBe(0);
  expect(clampEnd(20, 2, 13)).toBe(13);
});

it("moves freely otherwise", () => {
  expect(clampStart(4.2, 10)).toBe(4.2);
  expect(clampEnd(8.5, 2, 13)).toBe(8.5);
});

it("offers trimming only for clips with a known, long enough duration", () => {
  expect(canTrim(13)).toBe(true);
  expect(canTrim(0.5)).toBe(false);
  expect(canTrim(NaN)).toBe(false);
  expect(canTrim(Infinity)).toBe(false);
});

it("recognizes a selection of the whole clip", () => {
  expect(isWholeClip(0, 13, 13)).toBe(true);
  expect(isWholeClip(0.5, 13, 13)).toBe(false);
  expect(isWholeClip(0, 12, 13)).toBe(false);
});
