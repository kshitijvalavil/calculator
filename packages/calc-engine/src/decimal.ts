import Decimal from "decimal.js";

/** Working precision for all arithmetic (contract: 34 significant digits). */
export const PRECISION = 34;
/** Output precision (contract: 20 significant digits, half-up). */
export const OUTPUT_DIGITS = 20;

const CONFIG = {
  precision: PRECISION,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -7,
  toExpPos: 21,
  maxE: 9e15,
  minE: -9e15,
  modulo: Decimal.ROUND_DOWN,
} as const;

const TRIG_CONFIG = { ...CONFIG, precision: 50 } as const;

/** Local clone so we never touch decimal.js's global configuration. */
export const D = Decimal.clone(CONFIG);
export type Dec = InstanceType<typeof D>;

/** Higher-precision clone used for degree conversion and trig, then rounded back to 34 digits. */
export const T = Decimal.clone(TRIG_CONFIG);

/**
 * decimal.js can leave a clone's precision/rounding modified if one of its
 * functions throws part-way (e.g. "Precision limit exceeded" inside sin).
 * Call this after catching an unexpected error.
 */
export function resetDecimalConfig(): void {
  D.set(CONFIG);
  T.set(TRIG_CONFIG);
}

export const PI = D.acos(-1);
export const E = new D(1).exp();
export const PI_T = T.acos(-1);
