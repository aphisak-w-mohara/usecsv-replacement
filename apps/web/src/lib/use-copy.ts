import { useState } from "react";

/**
 * Copy-to-clipboard with a transient "copied" flag for button feedback.
 * `copied` flips true on a successful write and resets after `resetMs`.
 */
export function useCopy(resetMs = 1500) {
  const [copied, setCopied] = useState(false);

  function copy(text: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), resetMs);
    });
  }

  return { copied, copy };
}
