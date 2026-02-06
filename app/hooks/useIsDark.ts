import { useSyncExternalStore } from "react";

let darkSnapshot = false;

function subscribe(cb: () => void) {
  // Initialise snapshot
  darkSnapshot = document.documentElement.classList.contains("dark");

  const observer = new MutationObserver(() => {
    const next = document.documentElement.classList.contains("dark");
    if (next !== darkSnapshot) {
      darkSnapshot = next;
      cb();
    }
  });

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });

  return () => observer.disconnect();
}

function getSnapshot() {
  return darkSnapshot;
}

function getServerSnapshot() {
  return false;
}

export function useIsDark(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
