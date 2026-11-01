import { serviceTitles } from "../shared/brand";
import { getLocale, rememberLocale } from "../shared/i18n";
import React from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { App } from "./App";
import { LandingPage } from "./LandingPage";
import "./landing.css";
import { DrivePreview } from "./DrivePreview";
import { drivePreviewData } from "./drive-preview";

document.documentElement.lang = getLocale();
if (document.title === serviceTitles.ja || document.title === serviceTitles.en) document.title = serviceTitles[getLocale()];
if (new URLSearchParams(location.search).has("lang")) {
  rememberLocale(getLocale());
}

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
