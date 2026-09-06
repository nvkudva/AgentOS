export function discountedCents(cents, rate) {
  // BUG: flooring loses up to a cent on every discounted line.
  return Math.floor(cents * rate);
}
export function orderTotal(lines, rate = 1) {
  return lines.reduce((sum, l) => sum + discountedCents(l.cents * l.qty, rate), 0);
}
