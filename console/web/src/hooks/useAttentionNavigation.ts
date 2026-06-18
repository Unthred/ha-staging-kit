import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

function flashAndScroll(hash: string) {
  const id = hash.replace(/^#/, "");
  if (!id) return;
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add("attention-target-flash");
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  window.setTimeout(() => el.classList.remove("attention-target-flash"), 2500);
}

/** Scroll/highlight a hash target once after navigation — does not refetch data. */
export function useAttentionNavigation(renderKey?: unknown) {
  const { hash } = useLocation();
  const lastHashRef = useRef("");

  useEffect(() => {
    if (!hash || hash === lastHashRef.current) return;
    lastHashRef.current = hash;
    const t = window.setTimeout(() => flashAndScroll(hash), renderKey != null ? 80 : 0);
    return () => window.clearTimeout(t);
  }, [hash, renderKey]);
}
