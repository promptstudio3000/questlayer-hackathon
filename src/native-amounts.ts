export function parseNearPrice(input: string): string {
  const match = /^(\d{1,4})(?:\.(\d{1,24}))?$/.exec(input.trim());
  if (!match) throw Error("Enter a NEAR amount with up to 24 decimal places.");
  const value =
    BigInt(match[1]) * 10n ** 24n + BigInt((match[2] || "").padEnd(24, "0"));
  if (value < 10n ** 21n || value > 1000n * 10n ** 24n)
    throw Error("Choose a price between 0.001 and 1,000 test NEAR.");
  return value.toString();
}
export function formatNativeNear(value: string): string {
  const amount = BigInt(value),
    whole = amount / 10n ** 24n,
    fraction = (amount % 10n ** 24n)
      .toString()
      .padStart(24, "0")
      .replace(/0+$/, "");
  return whole.toString() + (fraction ? "." + fraction : "");
}
