import { useLayoutEffect, useRef } from 'react';

export default function ChatComposerInput({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const field = input.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(112, Math.max(28, field.scrollHeight))}px`;
  }, [value]);
  return (
    <textarea
      ref={input}
      aria-label={label}
      placeholder="Сообщение…"
      rows={1}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="chat-composer-input"
    />
  );
}
