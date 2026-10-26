import type { AngleUnit, CalcError, Calculation, Mode } from "../../../../contract/types";
import { createApiClient, type ApiClient } from "./api";
import { evaluate } from "./engine";

export interface SaveInput {
  expression: string;
  mode: Mode;
  angle: AngleUnit;
}

export type SaveOutcome = { ok: true; calculation: Calculation } | { ok: false; error: CalcError };

/** Where saved calculations live. Same UI either way. */
export interface HistoryStore {
  readonly kind: "local" | "api";
  list(): Promise<Calculation[]>;
  /** Evaluates and saves. In API mode the server recomputes and its result is returned. */
  save(input: SaveInput): Promise<SaveOutcome>;
  updateLabel(id: string, label: string | null): Promise<Calculation>;
  remove(id: string): Promise<void>;
}

export const LOCAL_KEY = "calc.history.v1";
/** Local history keeps the newest entries only, so it stays fast. */
export const MAX_LOCAL = 500;
const MAX_LABEL = 80;

export const normalizeLabel = (label: string | null): string | null => {
  const t = (label ?? "").trim().slice(0, MAX_LABEL);
  return t === "" ? null : t;
};

const MODES = new Set(["standard", "scientific"]);
const ANGLES = new Set(["deg", "rad"]);

/** True for a well-formed history row. Anything else (null, {}, numbers, bad fields) is dropped. */
export function isCalculation(v: unknown): v is Calculation {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === "string" && r.id.length > 0 &&
    typeof r.expression === "string" && r.expression.length > 0 && r.expression.length <= 500 &&
    typeof r.result === "string" && r.result.length > 0 && r.result.length <= 2000 &&
    typeof r.mode === "string" && MODES.has(r.mode) &&
    typeof r.angle === "string" && ANGLES.has(r.angle) &&
    (r.label === null || (typeof r.label === "string" && r.label.length <= 80)) &&
    typeof r.created_at === "string"
  );
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** localStorage-backed history, used when Supabase isn't configured. */
export function createLocalStore(storage: Storage = window.localStorage): HistoryStore {
  const read = (): Calculation[] => {
    try {
      const raw = storage.getItem(LOCAL_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(isCalculation).slice(0, MAX_LOCAL) : [];
    } catch {
      return [];
    }
  };
  const write = (rows: Calculation[]) => {
    try {
      storage.setItem(LOCAL_KEY, JSON.stringify(rows.slice(0, MAX_LOCAL)));
    } catch {
      /* storage full or blocked: history just won't persist */
    }
  };
  const find = (id: string): Calculation => {
    const row = read().find((r) => r.id === id);
    if (!row) throw new Error("Not found");
    return row;
  };

  return {
    kind: "local",
    async list() {
      return read();
    },
    async save({ expression, mode, angle }) {
      const res = evaluate(expression, angle);
      if (!res.ok) return res;
      const calculation: Calculation = {
        id: newId(),
        expression: expression.slice(0, 500),
        result: res.result,
        mode,
        angle,
        label: null,
        created_at: new Date().toISOString(),
      };
      write([calculation, ...read()]);
      return { ok: true, calculation };
    },
    async updateLabel(id, label) {
      const updated = { ...find(id), label: normalizeLabel(label) };
      write(read().map((r) => (r.id === id ? updated : r)));
      return updated;
    },
    async remove(id) {
      write(read().filter((r) => r.id !== id));
    },
  };
}

/** Edge Function-backed history using an anonymous Supabase session. */
export function createApiStore(client: ApiClient): HistoryStore {
  return {
    kind: "api",
    list: async () => (await client.history(50)).filter(isCalculation),
    save: (input) => client.calculate(input),
    updateLabel: (id, label) => client.updateLabel(id, normalizeLabel(label)),
    remove: (id) => client.remove(id),
  };
}

/** Builds a token provider from supabase-js anonymous sign-in (loaded lazily). */
export function supabaseTokenProvider(url: string, anonKey: string) {
  let clientPromise: Promise<import("@supabase/supabase-js").SupabaseClient> | null = null;
  const getClient = () =>
    (clientPromise ??= import("@supabase/supabase-js").then(({ createClient }) =>
      createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } }),
    ));

  let pending: Promise<string> | null = null;
  return (refresh = false): Promise<string> => {
    if (pending && !refresh) return pending;
    pending = (async () => {
      const supabase = await getClient();
      if (!refresh) {
        const { data } = await supabase.auth.getSession();
        if (data.session?.access_token) return data.session.access_token;
      } else {
        const { data } = await supabase.auth.refreshSession();
        if (data.session?.access_token) return data.session.access_token;
      }
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error || !data.session) throw new Error(error?.message ?? "Couldn't sign in");
      return data.session.access_token;
    })();
    pending.catch(() => (pending = null));
    return pending;
  };
}

export interface HistoryEnv {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}

/** Local mode unless both Supabase env vars are set. */
export function createHistoryStore(env: HistoryEnv = import.meta.env as HistoryEnv): HistoryStore {
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return createLocalStore();
  return createApiStore(
    createApiClient({
      baseUrl: `${url.replace(/\/+$/, "")}/functions/v1/calculate`,
      getToken: supabaseTokenProvider(url, key),
    }),
  );
}
