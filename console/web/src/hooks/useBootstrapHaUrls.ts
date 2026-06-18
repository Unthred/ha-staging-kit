import { useEffect } from "react";
import { settingsApi } from "../api";
import { setHaUrls } from "../lib/haUrlsStore";

/** Load canonical HA URLs from server settings (overrides stale localStorage). */
export function useBootstrapHaUrls() {
  useEffect(() => {
    settingsApi
      .get()
      .then((settings) => {
        setHaUrls(settings.staging.url ?? "", settings.prod.url ?? "");
      })
      .catch(() => {
        /* settings unavailable during early onboarding — keep cached URLs */
      });
  }, []);
}
