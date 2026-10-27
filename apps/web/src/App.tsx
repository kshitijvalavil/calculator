import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Calculation } from "../../../contract/types";
import { Display } from "./components/Display";
import { HistoryTape } from "./components/HistoryTape";
import { MoonIcon, ReceiptIcon, SunIcon } from "./components/icons";
import { Keypad, type PadHandlers } from "./components/Keypad";
import { ScientificPanel } from "./components/ScientificPanel";
import { useHistory } from "./hooks/useHistory";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { useTheme } from "./hooks/useTheme";
import { calcReducer, computePreview, expressionToEvaluate, initialState } from "./lib/calculator";
import { evaluate } from "./lib/engine";
import { MAX_PASTE, sanitizePaste, toSegments, type Token } from "./lib/expression";
import type { HistoryStore } from "./lib/history";
import { readItem, writeItem } from "./lib/storage";
import { commandForKey, keyIdFor, type KeyCommand } from "./lib/keymap";

const MODE_KEY = "calc.mode";

/**
 * The button last focused by a pointer. A button reached with Tab keeps native Enter/Space;
 * one that merely kept focus after a click doesn't, so Enter still means "=".
 */
let pointerFocused: Element | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", (e) => {
    pointerFocused = e.target instanceof Element ? e.target.closest("button, a") : null;
  }, true);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Tab") pointerFocused = null;
  }, true);
}

function storedMode() {
  return readItem(MODE_KEY) === "scientific" ? "scientific" : "standard";
}

export function App({ store }: { store: HistoryStore }) {
  const [state, dispatch] = useReducer(calcReducer, undefined, () => initialState({ mode: storedMode() }));
  const history = useHistory(store);
  const { theme, toggle: toggleTheme } = useTheme();
  const wide = useMediaQuery("(min-width: 1024px)");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pasteNotice, setPasteNotice] = useState<string | null>(null);
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const pressTimer = useRef<number | undefined>(undefined);
  const historyBtnRef = useRef<HTMLButtonElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const preview = useMemo(() => computePreview(state.tokens, state.angle, evaluate), [state.tokens, state.angle]);
  const segments = useMemo(() => toSegments(state.tokens), [state.tokens]);

  useEffect(() => {
    writeItem(MODE_KEY, state.mode);
  }, [state.mode]);

  const equals = useCallback(async () => {
    const s = stateRef.current;
    if (s.evaluated || s.tokens.length === 0) return;
    const { tokens, expression } = expressionToEvaluate(s.tokens);
    const res = evaluate(expression, s.angle);
    dispatch({
      type: "evaluated",
      tokens,
      evaluated: res.ok ? { expression, result: res.result } : { expression, error: res.error },
    });
    if (!res.ok) return;
    const outcome = await history.save({ expression, mode: s.mode, angle: s.angle });
    // In API mode the server's recomputed result is the one that counts.
    if (outcome?.ok && outcome.calculation.result !== res.result) {
      dispatch({ type: "serverResult", expression, result: outcome.calculation.result });
    }
  }, [history.save]);

  const handlers: PadHandlers = useMemo(
    () => ({
      onKey: (key: Token) => dispatch({ type: "key", key }),
      onEquals: () => void equals(),
      onBack: () => dispatch({ type: "back" }),
      onClear: () => dispatch({ type: "clear" }),
      onSign: () => dispatch({ type: "sign" }),
    }),
    [equals],
  );

  const flash = useCallback((id: string) => {
    setPressedKey(id);
    window.clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(() => setPressedKey(null), 140);
  }, []);

  const run = useCallback(
    (cmd: KeyCommand) => {
      if (cmd.type === "key") handlers.onKey(cmd.key);
      else if (cmd.type === "equals") handlers.onEquals();
      else if (cmd.type === "back") handlers.onBack();
      else handlers.onClear();
      flash(keyIdFor(cmd));
      setPasteNotice(null);
    },
    [handlers, flash],
  );

  // Global keyboard support. Text fields and keyboard-focused buttons keep their own Enter/Space.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (e.key === "Escape" && sheetOpen) {
        setSheetOpen(false);
        historyBtnRef.current?.focus();
        return;
      }
      const interactive = target?.closest("button, a");
      if ((e.key === "Enter" || e.key === " ") && interactive) {
        if (interactive !== pointerFocused) return;
        if (e.key === " ") {
          e.preventDefault();
          return;
        }
      }
      const cmd = commandForKey(e.key);
      if (!cmd) return;
      e.preventDefault();
      run(cmd);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [run, sheetOpen]);

  const sheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (sheetOpen) sheetRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, [sheetOpen]);

  // Ctrl/Cmd+V of a plain-text expression. Text fields keep their own paste.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const pasted = sanitizePaste(e.clipboardData?.getData("text/plain") ?? "");
      e.preventDefault();
      if (!pasted.ok) {
        setPasteNotice(`That's too long to paste, max ${MAX_PASTE} characters`);
        return;
      }
      setPasteNotice(null);
      if (pasted.tokens.length) dispatch({ type: "paste", tokens: pasted.tokens });
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    requestAnimationFrame(() => historyBtnRef.current?.focus());
  }, []);

  const reuseExpression = useCallback(
    (c: Calculation) => {
      dispatch({ type: "loadExpression", expression: c.expression });
      if (c.mode === "scientific") {
        dispatch({ type: "mode", mode: "scientific" });
        dispatch({ type: "angle", angle: c.angle });
      }
      if (!wide) closeSheet();
    },
    [wide, closeSheet],
  );
  const reuseResult = useCallback(
    (c: Calculation) => {
      dispatch({ type: "insertValue", value: c.result });
      if (!wide) closeSheet();
    },
    [wide, closeSheet],
  );

  const scientific = state.mode === "scientific";
  const tape = (
    <HistoryTape
      items={history.items}
      loading={history.loading}
      storeKind={store.kind}
      persistent={store.persistent !== false}
      onReuseExpression={reuseExpression}
      onReuseResult={reuseResult}
      onLabel={history.updateLabel}
      onDelete={history.remove}
      onClose={wide ? undefined : closeSheet}
    />
  );

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            <span />
            <span />
          </span>
          <span className="brand__name">Tally</span>
        </div>
        <div className="topbar__actions">
          {!wide && (
            <button
              ref={historyBtnRef}
              type="button"
              className="icon-btn"
              aria-label={`Open history, ${history.items.length} ${history.items.length === 1 ? "entry" : "entries"}`}
              aria-expanded={sheetOpen}
              aria-controls="history-sheet"
              onClick={() => setSheetOpen(true)}
            >
              <ReceiptIcon />
              {history.items.length > 0 && <span className="badge" aria-hidden="true">{history.items.length}</span>}
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            data-testid="theme-toggle"
            onClick={toggleTheme}
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </header>

      <main className="stage">
        <h1 className="sr-only">Tally calculator</h1>
        <section className={`calc ${scientific ? "calc--sci" : ""}`} aria-label="Calculator">
          <div className="calc__toolbar">
            <div className="segmented" role="group" aria-label="Calculator mode">
              {(["standard", "scientific"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className="segmented__btn"
                  aria-pressed={state.mode === m}
                  aria-controls={m === "scientific" && scientific ? "scientific-keys" : undefined}
                  onClick={() => dispatch({ type: "mode", mode: m })}
                >
                  {m === "standard" ? "Standard" : "Scientific"}
                </button>
              ))}
            </div>
          </div>

          <Display
            segments={segments}
            evaluated={state.evaluated}
            preview={preview}
            mode={state.mode}
            angle={state.angle}
          />

          <div className="calc__pads">
            {scientific && (
              <ScientificPanel
                angle={state.angle}
                onAngle={(angle) => dispatch({ type: "angle", angle })}
                onKey={handlers.onKey}
                pressedKey={pressedKey}
              />
            )}
            <Keypad handlers={handlers} pressedKey={pressedKey} />
          </div>

          {(pasteNotice ?? history.notice) && (
            <p className="notice" role="alert">
              {pasteNotice ?? history.notice}
              <button
                type="button"
                className="notice__dismiss"
                onClick={() => (pasteNotice ? setPasteNotice(null) : history.dismissNotice())}
              >
                Dismiss
              </button>
            </p>
          )}
        </section>

        {wide && <aside className="tape-panel" aria-label="History panel">{tape}</aside>}
      </main>

      {!wide && sheetOpen && (
        <div className="sheet" id="history-sheet">
          <div className="sheet__backdrop" onClick={closeSheet} aria-hidden="true" />
          <div ref={sheetRef} className="sheet__panel" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="history-title">
            {tape}
          </div>
        </div>
      )}
    </div>
  );
}
