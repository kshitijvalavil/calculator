import type {
  CalcError,
  Calculation,
  CalculateRequest,
  HistoryResponse,
  UpdateLabelRequest,
} from "../../../../contract/types";

/** Thrown for transport problems and unexpected statuses (not for CalcErrors). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type CalculateOutcome =
  | { ok: true; calculation: Calculation }
  | { ok: false; error: CalcError };

export interface ApiClientOptions {
  /** `<SUPABASE_URL>/functions/v1/calculate` */
  baseUrl: string;
  /** Returns a user JWT. `refresh` is true after a 401, to force a new session. */
  getToken: (refresh?: boolean) => Promise<string>;
  fetch?: typeof fetch;
}

export interface ApiClient {
  calculate(body: CalculateRequest): Promise<CalculateOutcome>;
  history(limit?: number): Promise<Calculation[]>;
  updateLabel(id: string, label: string | null): Promise<Calculation>;
  remove(id: string): Promise<void>;
}

/** Client for the "calculate" Edge Function endpoints in contract/types.ts. */
export function createApiClient({ baseUrl, getToken, fetch: f = fetch }: ApiClientOptions): ApiClient {
  const base = baseUrl.replace(/\/+$/, "");

  async function send(path: string, init: RequestInit, retried = false): Promise<Response> {
    const token = await getToken(retried);
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    let res: Response;
    try {
      res = await f(`${base}${path}`, { ...init, headers });
    } catch (e) {
      throw new ApiError(e instanceof Error ? e.message : "Network error", 0, "NETWORK");
    }
    if (res.status === 401 && !retried) return send(path, init, true);
    return res;
  }

  async function fail(res: Response): Promise<never> {
    let code: string | undefined;
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      code = body.error?.code;
      if (body.error?.message) message = body.error.message;
    } catch {
      /* non-JSON body */
    }
    throw new ApiError(message, res.status, code);
  }

  return {
    async calculate(body) {
      const res = await send("/calculate", { method: "POST", body: JSON.stringify(body) });
      if (res.status === 201 || res.status === 200) {
        const data = (await res.json()) as { calculation: Calculation };
        return { ok: true, calculation: data.calculation };
      }
      if (res.status === 422) {
        const data = (await res.json()) as { error: CalcError };
        return { ok: false, error: data.error };
      }
      return fail(res);
    },

    async history(limit = 50) {
      const res = await send(`/history?limit=${limit}`, { method: "GET" });
      if (!res.ok) return fail(res);
      return ((await res.json()) as HistoryResponse).calculations;
    },

    async updateLabel(id, label) {
      const body: UpdateLabelRequest = { label };
      const res = await send(`/history/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      if (!res.ok) return fail(res);
      return ((await res.json()) as { calculation: Calculation }).calculation;
    },

    async remove(id) {
      const res = await send(`/history/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.status !== 204 && !res.ok) return fail(res);
    },
  };
}
