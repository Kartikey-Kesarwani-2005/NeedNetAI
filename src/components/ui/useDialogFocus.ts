"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Dialog accessibility primitive: focus trap, Escape-to-close, body scroll
 * lock, and focus restoration.
 *
 * Modals in this app are custom (no headless dialog dependency), so these
 * behaviours have to be implemented explicitly. The initial focus target is
 * usually the close button; every other focusable node stays reachable by
 * Tab, and Tab/Shift+Tab wrap inside the dialog instead of leaking to the
 * page behind the scrim.
 */
export function useDialogFocus(
  onClose: () => void,
  initialFocus?: { readonly current: HTMLElement | null },
): RefObject<HTMLDivElement | null> {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Keep the latest close handler without re-running the whole effect (and
  // re-focusing/re-locking scroll) whenever a parent renders a new arrow fn.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const container = containerRef.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const frame = requestAnimationFrame(() => {
      const target = initialFocus?.current ?? container?.querySelector<HTMLElement>(FOCUSABLE) ?? container;
      target?.focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !container) return;

      const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (node) => node.offsetParent !== null || node === document.activeElement,
      );
      if (nodes.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === container)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [initialFocus]);

  return containerRef;
}
