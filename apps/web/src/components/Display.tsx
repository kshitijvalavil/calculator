import { useLayoutEffect, useRef, useState } from "react";
import type { AngleUnit, Mode } from "../../../../contract/types";
import type { Evaluated, Preview } from "../lib/calculator";
import type { Segment } from "../lib/expression";
import { friendlyError } from "../lib/messages";

interface Props {
  segments: Segment[];
  evaluated: Evaluated | null;
  preview: Preview;
  mode: Mode;
  angle: AngleUnit;
}

/** Font size steps so long numbers shrink before they need to scroll. */
export function resultSizeClass(text: string): string {
  const n = text.length;
  if (n <= 9) return "result--xl";
  if (n <= 12) return "result--lg";
  if (n <= 16) return "result--md";
  if (n <= 21) return "result--sm";
  return "result--xs";
}

/** Keeps the end of a scrolling line in view and makes it focusable only while it overflows. */
function useScrollToEnd<T extends HTMLElement>(dep: unknown) {
  const ref = useRef<T>(null);
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth;
    setOverflowing(el.scrollWidth > el.clientWidth + 1);
  }, [dep]);
  return { ref, overflowing };
}

export function Display({ segments, evaluated, preview, mode, angle }: Props) {
  let resultText = "0";
  let state: "idle" | "preview" | "final" | "error" = "idle";
  if (evaluated?.error) {
    resultText = friendlyError(evaluated.error);
    state = "error";
  } else if (evaluated?.result !== undefined) {
    resultText = evaluated.result;
    state = "final";
  } else if (preview.kind === "value") {
    resultText = preview.text;
    state = "preview";
  } else if (preview.kind === "error") {
    resultText = friendlyError(preview.error);
    state = "error";
  }

  const exprKey = segments.map((s) => s.text).join("") + (evaluated ? "=" : "");
  const expr = useScrollToEnd<HTMLDivElement>(exprKey);
  const res = useScrollToEnd<HTMLDivElement>(resultText);
  const lastIndex = segments.length - 1;

  return (
    <div className="display" data-state={state}>
      <div className="display__meta" aria-hidden="true">
        <span>{mode === "scientific" ? "Scientific" : "Standard"}</span>
        {mode === "scientific" && <span className="display__angle">{angle.toUpperCase()}</span>}
      </div>
      <div
        ref={expr.ref}
        className="display__expr"
        data-testid="expression"
        aria-label="Expression"
        role="textbox"
        aria-readonly="true"
        tabIndex={expr.overflowing ? 0 : -1}
      >
        {segments.length === 0 ? (
          <span className="display__placeholder">&nbsp;</span>
        ) : (
          segments.map((s, i) =>
            i === lastIndex && !evaluated ? (
              // Spaces around an operator stay outside the highlight so it hugs the symbol.
              <span key={i} className={`tok tok--${s.kind}`}>
                {s.text.startsWith(" ") && " "}
                <mark className={`tok--last tok--${s.kind}`}>{s.text.trim()}</mark>
                {s.text.endsWith(" ") && " "}
              </span>
            ) : (
              <span key={i} className={`tok tok--${s.kind}`}>
                {s.text}
              </span>
            ),
          )
        )}
        {evaluated && <span className="tok tok--equals"> =</span>}
      </div>
      <div
        ref={res.ref}
        className="display__result-wrap"
        tabIndex={res.overflowing ? 0 : -1}
        aria-label={res.overflowing ? "Result, scroll to see all digits" : undefined}
        role={res.overflowing ? "region" : undefined}
      >
        <output
          className={`display__result ${state === "error" ? "result--error" : resultSizeClass(resultText)}`}
          data-testid="result"
          data-state={state}
          aria-live="polite"
          aria-atomic="true"
        >
          {resultText}
        </output>
      </div>
    </div>
  );
}
