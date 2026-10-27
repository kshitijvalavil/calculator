import { memo, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Calculation } from "../../../../contract/types";
import { clampLabel, labelLength, MAX_LABEL_CHARS } from "../lib/history";
import { CheckIcon, CloseIcon, ReceiptIcon, TagIcon, TrashIcon } from "./icons";

interface Props {
  items: Calculation[];
  loading: boolean;
  storeKind: "local" | "api";
  /** False when browser storage is blocked and history is kept in memory only. */
  persistent?: boolean;
  onReuseExpression: (c: Calculation) => void;
  onReuseResult: (c: Calculation) => void;
  onLabel: (id: string, label: string | null) => void;
  onDelete: (id: string) => void;
  /** Present when shown as a mobile sheet. */
  onClose?: () => void;
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/** Rows rendered at first; more appear on request so long histories stay fast. */
export const PAGE_SIZE = 100;

const TapeItem = memo(function TapeItem({
  item,
  onReuseExpression,
  onReuseResult,
  onLabel,
  onDelete,
}: { item: Calculation } & Pick<Props, "onReuseExpression" | "onReuseResult" | "onLabel" | "onDelete">) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.label ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const editBtnRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const finish = (save: boolean) => {
    if (save) onLabel(item.id, draft);
    else setDraft(item.label ?? "");
    // Hand the keyboard back to the calculator (or the sheet it lives in), so the next
    // Enter evaluates instead of reopening this editor.
    const sheet = formRef.current?.closest<HTMLElement>("[role=dialog]");
    setEditing(false);
    requestAnimationFrame(() => (sheet ?? document.getElementById(CALC_FOCUS_ID))?.focus());
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
  };

  const created = new Date(item.created_at);
  return (
    <li className="tape__item" data-testid="history-item">
      {editing ? (
        <form
          ref={formRef}
          className="tape__label-form"
          onSubmit={(e) => {
            e.preventDefault();
            finish(true);
          }}
        >
          <input
            ref={inputRef}
            className="tape__label-input"
            value={draft}
            placeholder="Add a label"
            aria-label={`Label for ${item.expression}`}
            aria-describedby={`label-count-${item.id}`}
            onChange={(e) => setDraft(clampLabel(e.target.value))}
            onKeyDown={onKeyDown}
          />
          <span className="tape__count" id={`label-count-${item.id}`}>
            {labelLength(draft)}/{MAX_LABEL_CHARS}
          </span>
          <button type="submit" className="icon-btn icon-btn--sm" aria-label="Save label">
            <CheckIcon />
          </button>
          <button type="button" className="icon-btn icon-btn--sm" aria-label="Cancel" onClick={() => finish(false)}>
            <CloseIcon width={18} height={18} />
          </button>
        </form>
      ) : (
        item.label && (
          <p className="tape__label" data-testid="history-label">
            {item.label}
          </p>
        )
      )}
      <button
        type="button"
        className="tape__expr"
        onClick={() => onReuseExpression(item)}
        aria-label={`Reuse expression ${item.expression}`}
      >
        {item.expression.replace(/sqrt\(/g, "√(")}
      </button>
      <button
        type="button"
        className="tape__result"
        data-testid="history-result"
        onClick={() => onReuseResult(item)}
        aria-label={`Reuse result ${item.result}`}
      >
        <span className="tape__eq">= </span>
        {item.result}
      </button>
      <div className="tape__foot">
        <span className="tape__meta">
          {!Number.isNaN(created.getTime()) && <time dateTime={item.created_at}>{timeFmt.format(created)}</time>}
          {item.mode === "scientific" && <span className="tape__chip">{item.angle.toUpperCase()}</span>}
        </span>
        <span className="tape__actions">
          <button
            ref={editBtnRef}
            type="button"
            className="icon-btn icon-btn--sm"
            aria-label={item.label ? `Edit label for ${item.expression}` : `Add label to ${item.expression}`}
            onClick={() => setEditing(true)}
          >
            <TagIcon />
          </button>
          <button
            type="button"
            className="icon-btn icon-btn--sm icon-btn--danger"
            aria-label={`Delete ${item.expression}`}
            onClick={() => onDelete(item.id)}
          >
            <TrashIcon />
          </button>
        </span>
      </div>
    </li>
  );
});

/** Element that takes keyboard focus when control returns to the calculator. */
export const CALC_FOCUS_ID = "calc-expression";

export function HistoryTape({ items, loading, storeKind, persistent = true, onClose, ...handlers }: Props) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  const shown = items.length > visible ? items.slice(0, visible) : items;
  return (
    <section className="tape" aria-labelledby="history-title">
      <header className="tape__header">
        <div>
          <h2 id="history-title" className="tape__title">
            History
          </h2>
          <p className="tape__sub">
            {storeKind === "api"
              ? "Synced to your account"
              : persistent
                ? "Saved on this device"
                : "Storage is blocked, so history lasts until you close this tab"}
          </p>
        </div>
        {onClose && (
          <button type="button" className="icon-btn" aria-label="Close history" onClick={onClose}>
            <CloseIcon />
          </button>
        )}
      </header>
      <div className="tape__paper">
        {loading ? (
          <p className="tape__empty">Loading…</p>
        ) : items.length === 0 ? (
          <div className="tape__empty">
            <ReceiptIcon width={28} height={28} />
            <p>No calculations yet.</p>
            <p>Press = and they'll print here.</p>
          </div>
        ) : (
          <ol className="tape__list" aria-label="Past calculations">
            {shown.map((item) => (
              <TapeItem
                key={item.id}
                item={item}
                onReuseExpression={handlers.onReuseExpression}
                onReuseResult={handlers.onReuseResult}
                onLabel={handlers.onLabel}
                onDelete={handlers.onDelete}
              />
            ))}
          </ol>
        )}
        {!loading && items.length > shown.length && (
          <button type="button" className="tape__more" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
            Show {Math.min(PAGE_SIZE, items.length - shown.length)} more of {items.length - shown.length}
          </button>
        )}
      </div>
    </section>
  );
}
