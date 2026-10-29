import assert from "node:assert/strict";
import test from "node:test";
import { recommendReallocation } from "../src/lib/recommendation";

test("uses the largest safe surplus first and protects each location minimum", () => {
  const result = recommendReallocation(
    [
      { locationId: "store", locationName: "Central Store", onHand: 2, checkedOut: 0, minimumRequired: 0 },
      { locationId: "ece", locationName: "ECE Lab", onHand: 15, checkedOut: 0, minimumRequired: 5 },
      { locationId: "lab", locationName: "Other Lab", onHand: 8, checkedOut: 0, minimumRequired: 6 },
    ],
    7,
  );

  assert.deepEqual(result.options.map((option) => [option.locationId, option.recommendedQuantity]), [["ece", 7]]);
  assert.equal(result.procurementQuantity, 0);
  assert.equal(result.options[0].onHand - result.options[0].recommendedQuantity, 8);
});

test("splits a request across sources and reports the remaining procurement gap", () => {
  const result = recommendReallocation(
    [
      { locationId: "a", locationName: "Store A", onHand: 4, checkedOut: 0, minimumRequired: 1 },
      { locationId: "b", locationName: "Lab B", onHand: 5, checkedOut: 0, minimumRequired: 2 },
    ],
    8,
  );

  assert.deepEqual(result.options.map((option) => option.recommendedQuantity), [3, 3]);
  assert.equal(result.procurementQuantity, 2);
});

test("does not recommend stock at or below its protected minimum", () => {
  const result = recommendReallocation(
    [{ locationId: "a", locationName: "Lab A", onHand: 2, checkedOut: 0, minimumRequired: 3 }],
    4,
  );

  assert.deepEqual(result.options, []);
  assert.equal(result.procurementQuantity, 4);
});

test("returns no transfer or procurement when nothing remains outstanding", () => {
  const result = recommendReallocation(
    [{ locationId: "a", locationName: "Store A", onHand: 12, checkedOut: 0, minimumRequired: 2 }],
    0,
  );

  assert.deepEqual(result.options, []);
  assert.equal(result.procurementQuantity, 0);
});

test("rejects invalid request and stock quantities", () => {
  assert.throws(() => recommendReallocation([], -1), RangeError);
  assert.throws(
    () => recommendReallocation([{ locationId: "a", locationName: "Lab", onHand: -1, checkedOut: 0, minimumRequired: 0 }], 1),
    RangeError,
  );
});

test("subtracts checked-out equipment from transferable surplus", () => {
  const result = recommendReallocation(
    [{ locationId: "ece", locationName: "ECE Lab", onHand: 8, checkedOut: 2, minimumRequired: 3 }],
    5,
  );

  assert.equal(result.options[0].availableSurplus, 3);
  assert.equal(result.options[0].recommendedQuantity, 3);
  assert.equal(result.procurementQuantity, 2);
});
