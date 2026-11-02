import { useState, type InputHTMLAttributes } from 'react';
import { displayNumber } from '../utils/displayNumber';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number;
  onValue: (value: number) => void;
};

/** Keep an editing draft so formatting never rewrites incomplete input or the
 * computational value merely because the field was focused or blurred. */
export function NumberInput({ value, onValue, ...props }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  return <input {...props} type="number" value={draft ?? displayNumber(value)}
    onFocus={(event) => { setDraft(event.currentTarget.value); props.onFocus?.(event); }}
    onChange={(event) => {
      const raw = event.currentTarget.value;
      setDraft(raw);
      if (raw !== '' && Number.isFinite(Number(raw))) onValue(Number(raw));
    }}
    onBlur={(event) => { setDraft(null); props.onBlur?.(event); }} />;
}
