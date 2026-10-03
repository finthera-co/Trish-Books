import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface LineDescriptionInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** Grow up to this many px, then scroll inside the box. */
  maxHeight?: number;
}

/**
 * A line-item description that looks like a one-line input but takes several
 * lines: Shift+Enter starts a new line, a plain Enter does not. The box grows
 * with its content (up to `maxHeight`) and shrinks back when lines are removed,
 * so a short description keeps the row compact.
 */
export function LineDescriptionInput({
  value,
  onChange,
  placeholder,
  className,
  maxHeight = 160,
}: LineDescriptionInputProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Re-measure after every value change (typing, paste, product pick, load).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight + (el.offsetHeight - el.clientHeight), maxHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [value, maxHeight]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        // Only Shift+Enter breaks the line; keep IME composition untouched.
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) e.preventDefault();
      }}
      className={cn(
        "flex min-h-10 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm leading-5 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    />
  );
}

/**
 * Tidy a multi-line description before saving: trailing spaces on each line,
 * runs of blank lines, and leading/trailing blank lines are dropped.
 */
export function tidyDescription(text: string): string {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
