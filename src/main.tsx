import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { DrivePreview } from "./DrivePreview";
import { drivePreviewData } from "./drive-preview";

if (location.protocol === "file:") {
  const mock = drivePreviewData(location.protocol, window.__OMAIWEB_MOCK__);
  // Missing/invalid data.js leaves the exported static shop content visible.
  if (mock) createRoot(document.getElementById("root")!).render(<DrivePreview mock={mock} />);
} else {
  createRoot(document.getElementById("root")!).render(<App />);
}
