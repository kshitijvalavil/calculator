import type { Calculation } from "../../../contract/types.ts";
import { RepoError, type CalculationsRepo, type NewCalculation, type RepoFactory } from "./repo.ts";

interface StoredRow extends Calculation {
  user_id: string;
  seq: number;
}

export interface InMemoryStoreOptions {
  /**
   * Maps a bearer token to a user id. Return null for an invalid token.
   * Default: the token itself is the user id.
   */
  resolveUser?: (token: string) => string | null;
  now?: () => Date;
  newId?: () => string;
}

/**
 * In-memory stand-in for public.calculations, for tests and local runs.
 * Mirrors the RLS rules: each repo from `repoFor` sees only its own user's rows.
 */
export class InMemoryCalculationsStore {
  private rows: StoredRow[] = [];
  private seq = 0;
  private readonly resolveUser: (token: string) => string | null;
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(options: InMemoryStoreOptions = {}) {
    this.resolveUser = options.resolveUser ?? ((token) => token);
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => crypto.randomUUID());
  }

  /** Every stored row, including user_id (for test assertions). */
  allRows(): (Calculation & { user_id: string })[] {
    return this.rows.map(({ seq: _seq, ...row }) => ({ ...row }));
  }

  readonly repoFor: RepoFactory = (token: string): CalculationsRepo => {
    const userId = this.resolveUser(token);
    if (!userId) throw new RepoError("unauthorized", "Invalid token");
    return this.scoped(userId);
  };

  private scoped(userId: string): CalculationsRepo {
    const toPublic = ({ user_id: _u, seq: _s, ...row }: StoredRow): Calculation => ({ ...row });
    const own = (id: string) => this.rows.find((r) => r.id === id && r.user_id === userId);

    return {
      insert: async (input: NewCalculation) => {
        const row: StoredRow = {
          id: this.newId(),
          user_id: userId,
          expression: input.expression,
          result: input.result,
          mode: input.mode,
          angle: input.angle,
          label: null,
          created_at: this.now().toISOString(),
          seq: ++this.seq,
        };
        this.rows.push(row);
        return toPublic(row);
      },
      list: async (limit: number) =>
        this.rows
          .filter((r) => r.user_id === userId)
          .sort((a, b) => (a.created_at === b.created_at ? b.seq - a.seq : a.created_at < b.created_at ? 1 : -1))
          .slice(0, limit)
          .map(toPublic),
      updateLabel: async (id: string, label: string | null) => {
        const row = own(id);
        if (!row) return null;
        row.label = label;
        return toPublic(row);
      },
      delete: async (id: string) => {
        const row = own(id);
        if (!row) return false;
        this.rows = this.rows.filter((r) => r !== row);
        return true;
      },
    };
  }
}
