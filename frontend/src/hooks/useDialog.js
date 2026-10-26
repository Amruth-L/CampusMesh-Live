import { useEffect, useRef } from "react";
export function useDialog(onClose) {
  const ref = useRef(null),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement,
      bodyOverflow = document.body.style.overflow;
    const dialog = ref.current;
    document.body.style.overflow = "hidden";
    dialog?.focus();
    const keydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
      }
      if (event.key !== "Tab") return;
      const nodes = [
        ...dialog.querySelectorAll(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
        ),
      ].filter((n) => n.getClientRects().length);
      const first = nodes[0],
        last = nodes.at(-1);
      if (!first) {
        event.preventDefault();
        dialog.focus();
      } else if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === dialog)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog?.addEventListener("keydown", keydown);
    return () => {
      dialog?.removeEventListener("keydown", keydown);
      document.body.style.overflow = bodyOverflow;
      previous?.focus();
    };
  }, []);
  return ref;
}
