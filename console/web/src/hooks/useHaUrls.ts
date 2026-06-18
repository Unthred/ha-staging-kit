import { useEffect, useState } from "react";
import { getHaUrls, subscribeHaUrls } from "../lib/haUrlsStore";

export function useHaUrls() {
  const [urls, setUrls] = useState(getHaUrls);
  useEffect(() => subscribeHaUrls(setUrls), []);
  return urls;
}
