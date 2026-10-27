import type { AngleUnit, Calculation, Mode } from "../../../contract/types.ts";

/** What the API inserts. id, user_id and created_at are always set by the database. */
export interface NewCalculation {
  expression: string;
  result: string;
  mode: Mode;
  angle: AngleUnit;
}

/**
 * Calculations of ONE caller. Every implementation is scoped to the user the
 * repo was created for: a row of another user behaves exactly like a missing row.
 */
export interface CalculationsRepo {
  insert(row: NewCalculation): Promise<Calculation>;
  /** Newest first. */
  list(limit: number): Promise<Calculation[]>;
  /** Returns null when the row doesn't exist or isn't the caller's. */
  updateLabel(id: string, label: string | null): Promise<Calculation | null>;
  /** Returns false when the row doesn't exist or isn't the caller's. */
  delete(id: string): Promise<boolean>;
}

/** Builds a repo bound to the caller's bearer token. May throw `RepoError("unauthorized")`. */
export type RepoFactory = (token: string) => CalculationsRepo | Promise<CalculationsRepo>;

export type RepoErrorKind = "unauthorized" | "failed";

export class RepoError extends Error {
  readonly kind: RepoErrorKind;
  override readonly cause: unknown;
  constructor(kind: RepoErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = "RepoError";
    this.kind = kind;
    this.cause = cause;
  }
}

/** Columns the API returns. user_id is never exposed. */
export const CALCULATION_COLUMNS = "id, expression, result, mode, angle, label, created_at";
