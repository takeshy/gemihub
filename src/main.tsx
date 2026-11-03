import { serviceTitles } from "../shared/brand";
import { getLocale, rememberLocale } from "../shared/i18n";
import React from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { App } from "./App";
import { LandingPage } from "./LandingPage";
import "./landing.css";
import { DrivePreview } from "./DrivePreview";
import { drivePreviewData } from "./drive-preview";

// Update an existing note worker to the retirement script. Never remove local note databases.
if (location.protocol !== "file:" && "serviceWorker" in navigator) {
  void navigator.serviceWorker.getRegistrations().then(registrations => Promise.all(registrations
    .filter(registration => registration.active && new URL(registration.active.scriptURL).pathname === "/sw.js")
    .map(registration => registration.update()))).catch(() => {});
}

document.documentElement.lang = getLocale();
if (document.title === serviceTitles.ja || document.title === serviceTitles.en) document.title = serviceTitles[getLocale()];
if (new URLSearchParams(location.search).has("lang")) {
  rememberLocale(getLocale());
}
// A new shop's default time zone comes from the browser on its first visit.
try { if (location.protocol !== "file:") document.cookie = `gemihub_tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}; Path=/; SameSite=Lax; Max-Age=31536000${location.protocol === "https:" ? "; Secure" : ""}`; } catch { /* Cookies may be blocked. */ }

if (location.protocol !== "file:" && location.pathname === "/lp") {
  const root = document.getElementById("root")!;
  if (root.dataset.page === "lp") hydrateRoot(root, <LandingPage />);
  else createRoot(root).render(<LandingPage />);
} else if (location.protocol === "file:") {
  const mock = drivePreviewData(location.protocol, window.__GEMIHUB_MOCK__);
  // Missing/invalid data.js leaves the exported static shop content visible.
  if (mock) createRoot(document.getElementById("root")!).render(<DrivePreview mock={mock} />);
} else {
  createRoot(document.getElementById("root")!).render(<App />);
}
