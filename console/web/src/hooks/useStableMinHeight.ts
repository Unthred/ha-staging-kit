import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

const STORAGE_PREFIX = "hsk-layout-h-";

function readStoredHeight(key: string): number | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function storeHeight(key: string, height: number) {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + key, String(Math.ceil(height)));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Remember panel height after first paint so later loads keep the same shell size. */
export function useStableMinHeight(key: string, enabled = true) {
  const ref = useRef<HTMLDivElement>(null);
  const [minHeight, setMinHeight] = useState<number | null>(() => readStoredHeight(key));

  useLayoutEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      // Clear minHeight so scrollHeight reflects content, not a previously cached floor.
      const prevMin = el.style.minHeight;
      el.style.minHeight = "0";
      const h = el.scrollHeight;
      el.style.minHeight = prevMin;
      if (h <= 0) return;
      const next = Math.ceil(h);
      storeHeight(key, next);
      setMinHeight((prev) => (prev === next ? prev : next));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, key]);

  const style: CSSProperties | undefined =
    minHeight != null ? { minHeight: `${minHeight}px` } : undefined;

  return { ref, style, minHeight };
}
