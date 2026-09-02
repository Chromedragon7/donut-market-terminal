const completeDiamondItem = String.raw`{"id":"minecraft:diamond","count":64,"display_name":"Diamond","lore":[],"enchants":{"enchantments":{"levels":{}},"trim":{"material":null,"pattern":null}},"contents":[]}`;
const seller = String.raw`{"name":"ExampleSeller","uuid":"01234567-89ab-cdef-0123-456789abcdef"}`;

/** Includes exact beyond-safe-integer decimal money and documented null page padding. */
export const listingNullPaddingBody =
  String.raw`{"status":200,"result":[{"item":${completeDiamondItem},"price":900719925474099312345.125,"seller":${seller},"time_left":59999},null,null]}`;

/** Two indistinguishable same-millisecond transactions exercise multiset ordinals. */
export const duplicateTransactionsBody =
  String.raw`{"status":200,"result":[{"item":${completeDiamondItem},"price":128.50,"seller":${seller},"unixMillisDateSold":1893456000123},{"item":${completeDiamondItem},"price":128.50,"seller":${seller},"unixMillisDateSold":1893456000123}]}`;

/** Mirrors the observed provider limitation where enchantment levels can be null. */
export const nullEnchantLevelsBody =
  String.raw`{"status":200,"result":[{"item":{"id":"minecraft:enchanted_book","count":1,"display_name":"Enchanted Book","lore":[],"enchants":{"enchantments":{"levels":null},"trim":null},"contents":[]},"price":1234,"seller":${seller},"unixMillisDateSold":1893456000123}]}`;

export const unauthorizedBody = String.raw`{"status":401,"result":"Unauthorized"}`;
export const rateLimitedBody = String.raw`{"status":429,"result":"Too many requests"}`;
export const malformedJsonBody = String.raw`{"status":200,"result":[`;

export const fixtureSeller = Object.freeze({
  name: "ExampleSeller",
  uuid: "01234567-89ab-cdef-0123-456789abcdef",
});
