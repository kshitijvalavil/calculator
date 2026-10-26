import type { ReactNode } from "react";

export type KeyVariant = "digit" | "op" | "fn" | "eq" | "sci";

interface KeyProps {
  id: string;
  label: ReactNode;
  ariaLabel: string;
  variant: KeyVariant;
  onPress: () => void;
  pressed?: boolean;
  className?: string;
  ariaPressed?: boolean;
}

export function Key({ id, label, ariaLabel, variant, onPress, pressed, className = "", ariaPressed }: KeyProps) {
  return (
    <button
      type="button"
      className={`key key--${variant} ${pressed ? "is-pressed" : ""} ${className}`}
      data-key={id}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      onClick={onPress}
    >
      <span className="key__label" aria-hidden="true">
        {label}
      </span>
    </button>
  );
}
