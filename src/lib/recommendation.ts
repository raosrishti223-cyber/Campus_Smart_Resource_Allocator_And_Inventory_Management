export type StockSource = {
  locationId: string;
  locationName: string;
  onHand: number;
  checkedOut: number;
  minimumRequired: number;
};

export type ReallocationOption = StockSource & {
  availableSurplus: number;
  recommendedQuantity: number;
};

export function recommendReallocation(
  sources: StockSource[],
  unfulfilledQuantity: number,
): { options: ReallocationOption[]; procurementQuantity: number } {
  if (!Number.isSafeInteger(unfulfilledQuantity) || unfulfilledQuantity < 0) {
    throw new RangeError("Unfulfilled quantity must be a non-negative safe integer.");
  }

  let remaining = unfulfilledQuantity;
  const options = sources
    .map((source) => {
      if (
        !Number.isSafeInteger(source.onHand) ||
        !Number.isSafeInteger(source.checkedOut) ||
        !Number.isSafeInteger(source.minimumRequired) ||
        source.onHand < 0 ||
        source.checkedOut < 0 ||
        source.checkedOut > source.onHand ||
        source.minimumRequired < 0
      ) {
        throw new RangeError("Stock quantities must be non-negative safe integers.");
      }
      return {
        ...source,
        availableSurplus: Math.max(0, source.onHand - source.checkedOut - source.minimumRequired),
      };
    })
    .filter((source) => source.availableSurplus > 0)
    .sort((left, right) => right.availableSurplus - left.availableSurplus)
    .map((source) => {
      const recommendedQuantity = Math.min(source.availableSurplus, remaining);
      remaining -= recommendedQuantity;
      return { ...source, recommendedQuantity };
    })
    .filter((source) => source.recommendedQuantity > 0);

  return { options, procurementQuantity: remaining };
}
