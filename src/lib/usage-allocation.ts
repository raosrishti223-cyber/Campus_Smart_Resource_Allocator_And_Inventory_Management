export function availableCheckoutAllocation(
  allocated: number,
  consumed: number,
  checkedOutEver: number,
): number {
  return Math.max(0, allocated - consumed - checkedOutEver);
}
