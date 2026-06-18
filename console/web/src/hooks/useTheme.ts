import { useAppearance } from "../context/AppearanceContext";

/** @deprecated Use useAppearance() instead */
export function useTheme() {
  const { resolvedTheme, appearance, setThemeMode } = useAppearance();
  const toggle = () => setThemeMode(resolvedTheme === "dark" ? "light" : "dark");
  return { theme: resolvedTheme, themeMode: appearance.themeMode, toggle };
}
