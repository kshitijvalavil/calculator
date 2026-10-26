import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Calculation } from "../../../../contract/types";
import { CheckIcon, CloseIcon, ReceiptIcon, TagIcon, TrashIcon } from "./icons";

interface Props {
  items: Calculation[];
  loading: boolean;
  storeKind: "local" | "api";
  onReuseExpression: (c: Calculation) => void;
  onReuseResult: (c: Calculation) => void;
  onLabel: (id: string, label: string | null) => void;
  onDelete: (id: string) => void;
  /** Present when shown as a mobile sheet. */
  onClose?: () => void;
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

function TapeItem({
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

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const finish = (save: boolean) => {
    if (save) onLabel(item.id, draft);
    else setDraft(item.label ?? "");
    setEditing(false);
    requestAnimationFrame(() => editBtnRef.current?.focus());
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
            maxLength={80}
            placeholder="Add a label"
            aria-label={`Label for ${item.expression}`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
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
      <div className="tape__row">
        <span className="tape__meta">
          {!Number.isNaN(created.getTime()) && <time dateTime={item.created_at}>{timeFmt.format(created)}</time>}
          {item.mode === "scientific" && <span className="tape__chip">{item.angle.toUpperCase()}</span>}
        </span>
        <button
          type="button"
          className="tape__result"
          data-testid="history-result"
          onClick={() => onReuseResult(item)}
          aria-label={`Reuse result ${item.result}`}
        >
          = {item.result}
        </button>
      </div>
      <div className="tape__actions">
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
      </div>
    </li>
  );
}

export function HistoryTape({ items, loading, storeKind, onClose, ...handlers }: Props) {
  return (
    <section className="tape" aria-labelledby="history-title">
      <header className="tape__header">
        <div>
          <h2 id="history-title" className="tape__title">
            History
          </h2>
          <p className="tape__sub">{storeKind === "api" ? "Synced to your account" : "Saved on this device"}</p>
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
            {items.map((item) => (
              <TapeItem key={item.id} item={item} {...handlers} />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
