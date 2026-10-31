import assert from "node:assert/strict";
import test from "node:test";
import { availableCheckoutAllocation } from "../src/lib/usage-allocation";

test("returning a partial checkout preserves the unused approved allowance", () => {
  assert.equal(availableCheckoutAllocation(12, 0, 3), 9);
});

test("returning all checked-out units does not restore their checkout allowance", () => {
  assert.equal(availableCheckoutAllocation(12, 0, 12), 0);
});

test("a later transfer adds allowance after earlier units were checked out and returned", () => {
  assert.equal(availableCheckoutAllocation(13, 0, 12), 1);
});
