import type { TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/cn";
import { fieldBase } from "./input";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean };

export function Textarea({ className, invalid, ...rest }: TextareaProps) {
  return (
    <textarea
      className={cn(fieldBase, "min-h-20 py-2 leading-relaxed", className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}
