import { useEffect } from "react";

// Keep app content and navigation in separate grid rows. The visual viewport
// tracks Safari's keyboard/toolbars without treating pinch-zoom as a resize.
export function useAppViewport(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    let frame = 0;
    let focusTimer = 0;
    const previous = root.style.getPropertyValue("--ledger-viewport");
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const viewport = window.visualViewport;
        const zoomed = viewport && Math.abs(viewport.scale - 1) > 0.05;
        const height = !zoomed && viewport ? viewport.height : window.innerHeight;
        root.style.setProperty("--ledger-viewport", `${Math.round(height)}px`);
        const input = document.activeElement?.matches('input,textarea,[contenteditable="true"]');
        root.classList.toggle("ledger-keyboard-open", Boolean(input && !zoomed && viewport && window.innerHeight - viewport.height > 140));
      });
    };
    const focusChange = () => { window.clearTimeout(focusTimer); focusTimer = window.setTimeout(update, 50); };
    root.classList.add("ledger-shell-active");
    update();
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    document.addEventListener("focusin", focusChange);
    document.addEventListener("focusout", focusChange);
    return () => {
      cancelAnimationFrame(frame); window.clearTimeout(focusTimer);
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      document.removeEventListener("focusin", focusChange); document.removeEventListener("focusout", focusChange);
      root.classList.remove("ledger-shell-active", "ledger-keyboard-open");
      if (previous) root.style.setProperty("--ledger-viewport", previous); else root.style.removeProperty("--ledger-viewport");
    };
  }, [enabled]);
}
