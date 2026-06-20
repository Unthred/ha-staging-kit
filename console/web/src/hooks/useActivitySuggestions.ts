import { useEffect, useState } from "react";
import { activityApi, type ActivityEntitySuggestion } from "../api";

export function useActivitySuggestions() {
  const [items, setItems] = useState<ActivityEntitySuggestion[]>([]);
  const [automationCount, setAutomationCount] = useState(0);
  const [scriptCount, setScriptCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const snapshot = await activityApi.suggestions();
        if (!cancelled) {
          setItems(snapshot.items ?? []);
          setAutomationCount(snapshot.automationCount ?? 0);
          setScriptCount(snapshot.scriptCount ?? 0);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load suggestions");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), 5 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return { items, automationCount, scriptCount, loading, error };
}
