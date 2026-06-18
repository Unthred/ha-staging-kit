type UrlsListener = (urls: { stagingUrl: string; prodUrl: string }) => void;
const listeners = new Set<UrlsListener>();

let _urls = {
  stagingUrl: localStorage.getItem("ha-kit-staging-url") ?? "",
  prodUrl: localStorage.getItem("ha-kit-prod-url") ?? "",
};

export function getHaUrls() {
  return _urls;
}

export function setHaUrls(stagingUrl: string, prodUrl: string) {
  _urls = { stagingUrl, prodUrl };
  localStorage.setItem("ha-kit-staging-url", stagingUrl);
  localStorage.setItem("ha-kit-prod-url", prodUrl);
  listeners.forEach((l) => l(_urls));
}

export function subscribeHaUrls(listener: UrlsListener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
