"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

/** Recover action focus; a reused control can explicitly yield to its result. */
export function useActionFocus<T extends HTMLElement>(busy: boolean) {
  const scopeRef = useRef<T>(null);
  const action = useRef<{ trigger: HTMLElement; preferResult: boolean; left: boolean; cleanup: () => void } | null>(null);

  function beginActionFocus(trigger: HTMLElement, options: { preferResult?: boolean } = {}) {
    action.current?.cleanup();
    const operation = { trigger, preferResult: Boolean(options.preferResult), left: false, cleanup: () => {} };
    function moved(event: Event) {
      const target = event.target;
      if (target instanceof Node && !scopeRef.current?.contains(target) &&
        (event.type === "pointerdown" || target !== document.body)) operation.left = true;
    }
    document.addEventListener("focusin", moved);
    document.addEventListener("pointerdown", moved);
    operation.cleanup = () => {
      document.removeEventListener("focusin", moved);
      document.removeEventListener("pointerdown", moved);
    };
    action.current = operation;
  }

  // Run after every committed render: a very fast response can batch away the
  // intermediate busy render, while still removing the original button.
  useLayoutEffect(() => {
    const operation = action.current;
    if (!operation || busy) return;
    action.current = null;
    operation.cleanup();
    const focused = document.activeElement;
    if (operation.left || !document.hasFocus() || (focused !== document.body && focused !== operation.trigger)) return;
    if (!operation.preferResult && operation.trigger.isConnected && !operation.trigger.matches(":disabled")) {
      if (focused === document.body) operation.trigger.focus({ preventScroll: true });
      return;
    }
    scopeRef.current?.querySelector<HTMLElement>("[data-action-result]")?.focus({ preventScroll: true });
  });
  useEffect(() => () => { action.current?.cleanup(); action.current = null; }, []);
  return { scopeRef, beginActionFocus };
}
