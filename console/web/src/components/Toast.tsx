import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

export type ToastTone = "ok" | "warn" | "err" | "info";

type ToastItem = { id: number; message: string; tone: ToastTone; icon: string };

const DEFAULT_ICONS: Record<ToastTone, string> = {
  ok: "🎉",
  warn: "🦥",
  err: "🫠",
  info: "🦆",
};

type ToastInput = string | { message: string; tone?: ToastTone; icon?: string };

const ToastContext = createContext<{ push: (input: ToastInput, tone?: ToastTone) => void } | null>(null);

function normalizeToast(input: ToastInput, tone?: ToastTone): Omit<ToastItem, "id"> {
  if (typeof input === "string") {
    const resolvedTone = tone ?? "info";
    return { message: input, tone: resolvedTone, icon: DEFAULT_ICONS[resolvedTone] };
  }
  const resolvedTone = input.tone ?? tone ?? "info";
  return {
    message: input.message,
    tone: resolvedTone,
    icon: input.icon ?? DEFAULT_ICONS[resolvedTone],
  };
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback((input: ToastInput, tone?: ToastTone) => {
    const toast = normalizeToast(input, tone);
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, ...toast }]);
    const duration = toast.tone === "err" ? 6500 : toast.tone === "warn" ? 5500 : 4500;
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast toast-${t.tone}`}
            role="status"
            onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
          >
            <span className="toast-icon" aria-hidden>
              {t.icon}
            </span>
            <span className="toast-body">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast requires ToastProvider");
  return ctx;
}
