import { expect, test } from "vitest";
import { canonicalJson } from "../src/core/canonical.js";

test("key order does not change the output", () => {
  expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
});

test("nested objects are sorted recursively", () => {
  const a = { outer: { z: 1, a: { y: 2, b: 3 } } };
  const b = { outer: { a: { b: 3, y: 2 }, z: 1 } };
  expect(canonicalJson(a)).toBe(canonicalJson(b));
});

test("array order is preserved", () => {
  expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  expect(canonicalJson([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
});

test("undefined values are dropped", () => {
  expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
});

test("primitives pass through", () => {
  expect(canonicalJson("x")).toBe('"x"');
  expect(canonicalJson(null)).toBe("null");
  expect(canonicalJson(42)).toBe("42");
});
