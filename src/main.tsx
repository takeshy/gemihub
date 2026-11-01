import { getLocale, rememberLocale } from "../shared/i18n";
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { DrivePreview } from "./DrivePreview";
import { drivePreviewData } from "./drive-preview";

document.documentElement.lang = getLocale();
if (getLocale() === "en" && document.title.startsWith("omaiweb —")) document.title = "omaiweb — Your shop, in your own words.";
if (new URLSearchParams(location.search).has("lang")) {
  rememberLocale(getLocale());
}

if (location.protocol === "file:") {
  const mock = drivePreviewData(location.protocol, window.__OMAIWEB_MOCK__);
  // Missing/invalid data.js leaves the exported static shop content visible.
  if (mock) createRoot(document.getElementById("root")!).render(<DrivePreview mock={mock} />);
} else {
  createRoot(document.getElementById("root")!).render(<App />);
}
