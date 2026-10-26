import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AngleUnit, Calculation, Mode } from "../../../contract/types.ts";
import {
  CALCULATION_COLUMNS,
  RepoError,
  type CalculationsRepo,
  type NewCalculation,
  type RepoFactory,
} from "./repo.ts";

export interface SupabaseRepoOptions {
  url: string;
  anonKey: string;
  /** Injectable for tests; defaults to supabase-js `createClient`. */
  createClient?: (url: string, key: string, options: Parameters<typeof createClient>[2]) => SupabaseClient;
}

interface PostgrestLikeError {
  code?: string;
  message?: string;
}

/** HTTP 401, a PostgREST JWT error, or "permission denied" (e.g. the anon role) means the caller isn't allowed. */
function toRepoError(error: PostgrestLikeError, status: number): RepoError {
  const unauthorized =
    status === 401 || error.code === "PGRST301" || error.code === "PGRST302" || error.code === "42501";
  return new RepoError(unauthorized ? "unauthorized" : "failed", error.message ?? "Database error", error);
}

function toCalculation(row: Record<string, unknown>): Calculation {
  return {
    id: String(row.id),
    expression: String(row.expression),
    result: String(row.result),
    mode: row.mode as Mode,
    angle: row.angle as AngleUnit,
    label: row.label == null ? null : String(row.label),
    created_at: String(row.created_at),
  };
}

/**
 * Repo factory backed by Supabase. Each request gets a client that sends the
 * CALLER's JWT (never a service key), so Postgres RLS decides what is visible:
 * user_id defaults to auth.uid() on insert, and other users' rows simply
 * aren't found on select/update/delete.
 *
 * Follows the migration's column grants: inserts send only expression,
 * result, mode and angle (id, user_id, created_at default in the DB), and
 * updates send only label.
 */
export function createSupabaseRepoFactory(options: SupabaseRepoOptions): RepoFactory {
  const make = options.createClient ?? createClient;
  return (token: string): CalculationsRepo => {
    const client = make(options.url, options.anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const table = () => client.from("calculations");

    return {
      async insert(input: NewCalculation) {
        const { data, error, status } = await table()
          .insert({ expression: input.expression, result: input.result, mode: input.mode, angle: input.angle })
          .select(CALCULATION_COLUMNS)
          .single();
        if (error) throw toRepoError(error, status);
        return toCalculation(data as Record<string, unknown>);
      },
      async list(limit: number) {
        const { data, error, status } = await table()
          .select(CALCULATION_COLUMNS)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(limit);
        if (error) throw toRepoError(error, status);
        return ((data ?? []) as Record<string, unknown>[]).map(toCalculation);
      },
      async updateLabel(id: string, label: string | null) {
        const { data, error, status } = await table()
          .update({ label })
          .eq("id", id)
          .select(CALCULATION_COLUMNS)
          .maybeSingle();
        if (error) throw toRepoError(error, status);
        return data ? toCalculation(data as Record<string, unknown>) : null;
      },
      async delete(id: string) {
        const { data, error, status } = await table().delete().eq("id", id).select("id");
        if (error) throw toRepoError(error, status);
        return Array.isArray(data) && data.length > 0;
      },
    };
  };
}
