import { useCallback, useEffect, useRef, useState } from "react";
import type { Calculation } from "../../../../contract/types";
import { MAX_LOCAL, type HistoryStore, type SaveInput, type SaveOutcome } from "../lib/history";

export function useHistory(store: HistoryStore) {
  const [items, setItems] = useState<Calculation[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const storeRef = useRef(store);
  storeRef.current = store;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    store
      .list()
      .then((rows) => alive && setItems(rows))
      .catch(() => alive && setNotice("Couldn't load your history"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [store]);

  const save = useCallback(async (input: SaveInput): Promise<SaveOutcome | null> => {
    try {
      const outcome = await storeRef.current.save(input);
      if (outcome.ok) {
        setItems((prev) => [outcome.calculation, ...prev.filter((r) => r.id !== outcome.calculation.id)].slice(0, MAX_LOCAL));
        setNotice(null);
      }
      return outcome;
    } catch {
      setNotice("Couldn't save to history. Your result is still shown.");
      return null;
    }
  }, []);

  const updateLabel = useCallback(async (id: string, label: string | null) => {
    try {
      const updated = await storeRef.current.updateLabel(id, label);
      setItems((prev) => prev.map((r) => (r.id === id ? updated : r)));
      setNotice(null);
    } catch {
      setNotice("Couldn't update that label");
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    let removed: Calculation[] = [];
    setItems((prev) => {
      removed = prev;
      return prev.filter((r) => r.id !== id);
    });
    try {
      await storeRef.current.remove(id);
      setNotice(null);
    } catch {
      setItems(removed);
      setNotice("Couldn't delete that entry");
    }
  }, []);

  return { items, loading, notice, dismissNotice: () => setNotice(null), save, updateLabel, remove };
}
