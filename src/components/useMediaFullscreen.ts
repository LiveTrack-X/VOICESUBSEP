import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** Keep the player mounted; embedded browsers may reject native fullscreen. */
export function useMediaFullscreen(container: RefObject<HTMLElement | null>) {
  const [expanded, setExpanded] = useState(false);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const expandedRef = useRef(false);
  const ownedNative = useRef(false);
  const mounted = useRef(false);

  const close = useCallback(() => {
    expandedRef.current = false;
    setExpanded(false);
    const element = container.current;
    if (element && document.fullscreenElement === element) {
      void document.exitFullscreen().catch(() => {
        // Leave an exit control visible if the browser refuses to leave yet.
        if (mounted.current && document.fullscreenElement === element) {
          expandedRef.current = true;
          setExpanded(true);
        }
      });
    }
  }, [container]);

  const open = useCallback(() => {
    const element = container.current;
    if (!element) return;
    expandedRef.current = true;
    setExpanded(true);
    if (!element.requestFullscreen || document.fullscreenEnabled === false)
      return;
    try {
      // Invoke synchronously from the click, retaining browser user activation.
      void element.requestFullscreen().then(() => {
        // Escape or unmount may happen while a browser request is pending.
        if (!expandedRef.current && document.fullscreenElement === element)
          void document.exitFullscreen().catch(() => {});
      }).catch(() => {
        // The viewport-sized preview remains usable without this permission.
      });
    } catch {
      // Some embedded implementations throw instead of returning a rejection.
    }
  }, [container]);

  useEffect(() => {
    mounted.current = true;
    const element = container.current;
    const onFullscreenChange = () => {
      const isOwned = document.fullscreenElement === container.current;
      setNativeFullscreen(isOwned);
      if (isOwned) {
        ownedNative.current = true;
        if (!expandedRef.current)
          void document.exitFullscreen().catch(() => {});
      } else if (ownedNative.current) {
        ownedNative.current = false;
        expandedRef.current = false;
        setExpanded(false);
      }
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      mounted.current = false;
      expandedRef.current = false;
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      if (element && document.fullscreenElement === element)
        void document.exitFullscreen().catch(() => {});
    };
  }, [container]);

  useEffect(() => {
    if (!expanded) return;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement : null;
    const rootOverflow = document.documentElement.style.overflow;
    const bodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    container.current?.querySelector<HTMLElement>("[data-fullscreen-exit]")
      ?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      } else if (event.key === "Tab") {
        const controls = Array.from(container.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex='0']",
        ) ?? []).filter((element) => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && (document.activeElement === first ||
          !container.current?.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last ||
          !container.current?.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.documentElement.style.overflow = rootOverflow;
      document.body.style.overflow = bodyOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [expanded, close, container]);

  return { expanded, nativeFullscreen, open, close };
}
