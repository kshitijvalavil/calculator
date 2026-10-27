// Every access to browser storage goes through here. Reading `window.localStorage` itself can
// throw (SecurityError when site data is blocked), so nothing else touches it directly.

/** In-memory Storage used when the browser's storage is unavailable. */
export function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
}

let probed: Storage | null | undefined;

/** The real localStorage if it can be read and written, otherwise null. */
export function browserStorage(): Storage | null {
  if (probed !== undefined) return probed;
  try {
    const s = window.localStorage;
    const k = "calc.__probe";
    s.setItem(k, "1");
    s.removeItem(k);
    probed = s;
  } catch {
    probed = null;
  }
  return probed;
}

/** For tests: forget the cached probe result. */
export function resetStorageProbe() {
  probed = undefined;
}

export function readItem(key: string): string | null {
  try {
    return browserStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeItem(key: string, value: string): void {
  try {
    browserStorage()?.setItem(key, value);
  } catch {
    /* blocked or full: not persisted */
  }
}

/** Removes every key this app owns (prefix "calc."). */
export function clearAppStorage(): void {
  try {
    const s = browserStorage();
    if (!s) return;
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k?.startsWith("calc.")) keys.push(k);
    }
    keys.forEach((k) => s.removeItem(k));
  } catch {
    /* blocked */
  }
}
