"use client";

/*
 * src/components/studio/EditableText.tsx — a text input that looks like plain
 * text and commits on Enter or blur (Escape cancels). Empty or whitespace-only
 * input is dropped and the old value comes back. Used for the plan name in
 * TopBar and room names in PlanPanel; the callers' store actions make each
 * commit one undo step.
 */
import { useRef, useState, type Ref } from "react";

interface Props {
  value: string;
  onCommit: (next: string) => void;
  label: string; // accessible name
  className?: string;
  max?: number;
  inputRef?: Ref<HTMLInputElement>;
  testId?: string;
}

export function EditableText({ value, onCommit, label, className = "", max = 80, inputRef, testId }: Props) {
  const [draft, setDraft] = useState<string | null>(null); // null = not editing, show the stored value
  const cancelled = useRef(false);

  const commit = () => {
    const next = draft?.trim().slice(0, max);
    if (!cancelled.current && next && next !== value) onCommit(next);
    setDraft(null);
  };

  return (
    <input
      ref={inputRef}
      data-testid={testId}
      aria-label={label}
      value={draft ?? value}
      maxLength={max}
      spellCheck={false}
      onFocus={(e) => {
        cancelled.current = false;
        setDraft(value);
        e.currentTarget.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
      className={`min-w-0 rounded bg-transparent px-1 hover:bg-black/5 focus:bg-white/70 ${className}`}
    />
  );
}
