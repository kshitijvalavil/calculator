import type { Token } from "../lib/expression";
import { BackspaceIcon } from "./icons";
import { Key, type KeyVariant } from "./Key";

export interface PadHandlers {
  onKey: (key: Token) => void;
  onEquals: () => void;
  onBack: () => void;
  onClear: () => void;
  onSign: () => void;
}

type Def = { id: string; label: React.ReactNode; aria: string; variant: KeyVariant; run: (h: PadHandlers) => void };

const k = (t: Token, label: string, aria: string, variant: KeyVariant): Def => ({
  id: t,
  label,
  aria,
  variant,
  run: (h) => h.onKey(t),
});

const digit = (d: Token) => k(d, d, d, "digit");

const KEYS: Def[] = [
  { id: "clear", label: "AC", aria: "all clear", variant: "fn", run: (h) => h.onClear() },
  { id: "back", label: <BackspaceIcon width={24} height={24} />, aria: "backspace", variant: "fn", run: (h) => h.onBack() },
  k("%", "%", "percent", "fn"),
  k("÷", "÷", "divide", "op"),
  digit("7"), digit("8"), digit("9"),
  k("×", "×", "multiply", "op"),
  digit("4"), digit("5"), digit("6"),
  k("−", "−", "minus", "op"),
  digit("1"), digit("2"), digit("3"),
  k("+", "+", "plus", "op"),
  { id: "sign", label: "±", aria: "toggle sign", variant: "digit", run: (h) => h.onSign() },
  digit("0"),
  k(".", ".", "decimal point", "digit"),
  { id: "equals", label: "=", aria: "equals", variant: "eq", run: (h) => h.onEquals() },
];

export function Keypad({ handlers, pressedKey }: { handlers: PadHandlers; pressedKey: string | null }) {
  return (
    <div className="keypad" role="group" aria-label="Keypad">
      {KEYS.map((d) => (
        <Key
          key={d.id}
          id={d.id}
          label={d.label}
          ariaLabel={d.aria}
          variant={d.variant}
          pressed={pressedKey === d.id}
          onPress={() => d.run(handlers)}
        />
      ))}
    </div>
  );
}
