import { useEffect } from "react";
import type { Language, FontSize, Theme } from "~/types/settings";

function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

function applyTheme(resolved: "light" | "dark") {
  const root = document.documentElement;
  if (resolved === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
  root.style.colorScheme = resolved;
}

export function useApplySettings(language: Language, fontSize: FontSize, theme: Theme = "system") {
  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}px`;
    document.documentElement.lang = language;
    localStorage.setItem("gemini-hub-fontSize", String(fontSize));
    localStorage.setItem("gemini-hub-language", language);
  }, [language, fontSize]);

  useEffect(() => {
    localStorage.setItem("gemini-hub-theme", theme);
    applyTheme(resolveTheme(theme));

    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = (e: MediaQueryListEvent) => {
        applyTheme(e.matches ? "dark" : "light");
      };
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
  }, [theme]);
}
