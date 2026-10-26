import type { AngleUnit } from "../../../../contract/types";
import type { Token } from "../lib/expression";
import { Key } from "./Key";

const SCI: { t: Token; label: React.ReactNode; aria: string }[] = [
  { t: "(", label: "(", aria: "left parenthesis" },
  { t: ")", label: ")", aria: "right parenthesis" },
  { t: "^", label: <>x<sup>y</sup></>, aria: "power" },
  { t: "sin(", label: "sin", aria: "sine" },
  { t: "cos(", label: "cos", aria: "cosine" },
  { t: "tan(", label: "tan", aria: "tangent" },
  { t: "ln(", label: "ln", aria: "natural logarithm" },
  { t: "log(", label: "log", aria: "logarithm base 10" },
  { t: "sqrt(", label: "√", aria: "square root" },
  { t: "π", label: "π", aria: "pi" },
  { t: "e", label: "e", aria: "Euler's number" },
  { t: "!", label: "n!", aria: "factorial" },
];

interface Props {
  angle: AngleUnit;
  onAngle: (a: AngleUnit) => void;
  onKey: (t: Token) => void;
  pressedKey: string | null;
}

export function ScientificPanel({ angle, onAngle, onKey, pressedKey }: Props) {
  return (
    <div className="sci" id="scientific-keys" role="group" aria-label="Scientific functions">
      <div className="angle-switch" role="group" aria-label="Angle unit">
        {(["deg", "rad"] as const).map((a) => (
          <button
            key={a}
            type="button"
            className="angle-switch__btn"
            aria-pressed={angle === a}
            aria-label={a === "deg" ? "degrees" : "radians"}
            onClick={() => onAngle(a)}
          >
            {a.toUpperCase()}
          </button>
        ))}
      </div>
      {SCI.map((s) => (
        <Key
          key={s.t}
          id={s.t}
          label={s.label}
          ariaLabel={s.aria}
          variant="sci"
          pressed={pressedKey === s.t}
          onPress={() => onKey(s.t)}
        />
      ))}
    </div>
  );
}
