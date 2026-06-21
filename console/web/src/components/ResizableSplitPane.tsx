import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { loadSplitPaneRatio, saveSplitPaneRatio } from "../lib/splitPanePreferences";

type ResizableSplitPaneProps = {
  id: string;
  start: ReactNode;
  end: ReactNode;
  /** Initial start-pane width as a fraction of the container (0–1). */
  defaultRatio?: number;
  minStartPx?: number;
  minEndPx?: number;
  className?: string;
  stackAtPx?: number;
};

export function ResizableSplitPane({
  id,
  start,
  end,
  defaultRatio = 0.34,
  minStartPx = 220,
  minEndPx = 280,
  className,
  stackAtPx = 960,
}: ResizableSplitPaneProps) {
  const [ratio, setRatio] = useState(() => loadSplitPaneRatio(id, defaultRatio));
  const [stacked, setStacked] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const ratioRef = useRef(ratio);
  const draggingRef = useRef(false);

  useEffect(() => {
    ratioRef.current = ratio;
  }, [ratio]);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${stackAtPx}px)`);
    const sync = () => setStacked(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [stackAtPx]);

  const clampRatio = useCallback(
    (next: number, width: number) => {
      const minStart = minStartPx / width;
      const maxStart = (width - minEndPx) / width;
      return Math.min(Math.max(minStart, next), maxStart);
    },
    [minStartPx, minEndPx],
  );

  const applyPointerRatio = useCallback(
    (clientX: number) => {
      const container = containerRef.current;
      if (!container || stacked) return;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0) return;
      const next = clampRatio((clientX - rect.left) / rect.width, rect.width);
      setRatio(next);
    },
    [clampRatio, stacked],
  );

  const finishDrag = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    document.body.classList.remove("ui-split-pane-dragging");
    saveSplitPaneRatio(id, ratioRef.current);
  }, [id]);

  const onHandlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (stacked) return;
      event.preventDefault();
      draggingRef.current = true;
      document.body.classList.add("ui-split-pane-dragging");
      event.currentTarget.setPointerCapture(event.pointerId);
      applyPointerRatio(event.clientX);
    },
    [applyPointerRatio, stacked],
  );

  const onHandlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      applyPointerRatio(event.clientX);
    },
    [applyPointerRatio],
  );

  const onHandlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      finishDrag();
    },
    [finishDrag],
  );

  const onHandleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (stacked) return;
      const container = containerRef.current;
      if (!container) return;
      const step = event.shiftKey ? 0.08 : 0.03;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setRatio((prev) => {
          const next = clampRatio(prev - step, container.getBoundingClientRect().width);
          saveSplitPaneRatio(id, next);
          return next;
        });
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setRatio((prev) => {
          const next = clampRatio(prev + step, container.getBoundingClientRect().width);
          saveSplitPaneRatio(id, next);
          return next;
        });
      }
    },
    [clampRatio, id, stacked],
  );

  useEffect(() => {
    return () => {
      if (draggingRef.current) {
        draggingRef.current = false;
        document.body.classList.remove("ui-split-pane-dragging");
      }
    };
  }, []);

  const paneClass = ["ui-split-pane", stacked ? "ui-split-pane--stacked" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");

  const splitStyle: CSSProperties | undefined = stacked
    ? undefined
    : { ["--ui-split-ratio" as string]: `${ratio * 100}%` };

  return (
    <div ref={containerRef} className={paneClass} style={splitStyle}>
      <div className="ui-split-pane-start">{start}</div>
      {!stacked && (
        <div
          className="ui-split-pane-handle"
          role="separator"
          aria-orientation="vertical"
          aria-valuemin={8}
          aria-valuemax={92}
          aria-valuenow={Math.round(ratio * 100)}
          aria-label="Resize panels"
          tabIndex={0}
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
          onKeyDown={onHandleKeyDown}
        />
      )}
      <div className="ui-split-pane-end">{end}</div>
    </div>
  );
}
