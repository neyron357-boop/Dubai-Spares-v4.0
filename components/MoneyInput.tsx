import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { sanitizeMoneyInput } from '../utils/moneyInput';

/** Keep the typed decimal separator until blur; committing each keystroke loses the decimal. */
export default function MoneyInput({
  value,
  onCommit,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: number;
  onCommit: (value: number) => void;
}) {
  const [raw, setRaw] = useState(String(value || ''));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setRaw(String(value || ''));
  }, [value]);
  return (
    <input
      {...props}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={raw}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(event) => setRaw(sanitizeMoneyInput(event.target.value))}
      onBlur={(event) => {
        focused.current = false;
        const amount = Number(raw || 0);
        if (Number.isFinite(amount)) {
          onCommit(Math.max(0, amount));
          setRaw(String(amount || ''));
        }
        props.onBlur?.(event);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        }
        props.onKeyDown?.(event);
      }}
    />
  );
}
