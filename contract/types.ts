// Shared contract for the calculator pilot. Owned by the Manager.
// Engineers import these types; change them only through the Manager.

export type Mode = "standard" | "scientific";
export type AngleUnit = "deg" | "rad";

export type CalcErrorCode =
  | "EMPTY"          // nothing to evaluate
  | "SYNTAX"         // malformed expression, unmatched parentheses, unknown token
  | "DIVIDE_BY_ZERO" // any division by zero, including 0 ÷ 0
  | "DOMAIN"         // sqrt of a negative, ln/log of <= 0, tan(90°), factorial of a non-integer or negative
  | "OVERFLOW";      // |result| >= 1e1000, or a factorial above 1000!

export interface CalcError {
  code: CalcErrorCode;
  message: string; // short, human-readable, e.g. "Can't divide by zero"
}

export interface EvaluateOptions {
  angle?: AngleUnit; // default "deg"
}

export type EvaluateResult =
  | { ok: true; result: string }
  | { ok: false; error: CalcError };

/** Engine entry point, exported by @calc/engine as `evaluate`. */
export type Evaluate = (expression: string, options?: EvaluateOptions) => EvaluateResult;

/** A row of public.calculations as the API returns it. */
export interface Calculation {
  id: string;           // uuid
  expression: string;   // as typed, max 500 chars
  result: string;       // engine output string, never a float
  mode: Mode;
  angle: AngleUnit;
  label: string | null; // max 80 chars
  created_at: string;   // ISO 8601
}

// ---- HTTP API (Supabase Edge Function "calculate") ----
// Every request carries `Authorization: Bearer <user JWT>` (anonymous sign-in is fine).
// Base URL: <SUPABASE_URL>/functions/v1/calculate

/** POST /calculate */
export interface CalculateRequest {
  expression: string;
  mode: Mode;
  angle?: AngleUnit;
}
/** 201 { calculation } on success (row saved); 422 { error } on a CalcError; 400 { error } on a bad body; 401 without auth. */
export type CalculateResponse = { calculation: Calculation } | { error: CalcError | { code: "BAD_REQUEST" | "UNAUTHORIZED" | "NOT_FOUND" | "METHOD_NOT_ALLOWED" | "INTERNAL"; message: string } };

/** GET /history?limit=50 → 200 { calculations } newest first. limit 1..200, default 50. */
export interface HistoryResponse {
  calculations: Calculation[];
}

/** PATCH /history/:id → 200 { calculation }; 404 if not the caller's row. label "" or null clears it. */
export interface UpdateLabelRequest {
  label: string | null;
}

/** DELETE /history/:id → 204; 404 if not the caller's row. */
