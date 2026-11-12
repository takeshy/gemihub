import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { confirmLeave } from "./leave-guard";

export const dashboardTabs = ["dashboard", "build", "assistant", "try", "basic", "menus", "staff", "images", "settings", "bookings", "payments", "transfers", "customers", "analytics", "coupons", "inquiries", "blog", "manual"] as const;
export type DashboardTab = typeof dashboardTabs[number];
export function dashboardTab(value: string | null | undefined, fallback: DashboardTab = "dashboard"): DashboardTab {
  if (value === "team") return "staff";
  if (value === "create-page") return "build";
  if (value === "hours" || value === "rules") return "basic";
  return (dashboardTabs as readonly string[]).includes(value || "") ? value as DashboardTab : fallback;
}
export function dashboardRoute(search: string, fallback: DashboardTab = "dashboard") {
  const query = new URLSearchParams(search);
  return {
    tab: query.has("customer") ? "customers" as const : dashboardTab(query.get("tab"), query.get("calendar") === "connected" ? "staff" : query.has("screen") ? "try" : fallback),
    shop: query.get("shop") || "",
    screen: query.get("screen") || undefined,
    article: query.get("article") || undefined,
    customer: query.get("customer") || "",
    customerImages: query.get("customerView") === "images",
    inquiry: query.get("inquiry") || "",
    focusRequest: query.get("request") === "1",
    intent: query.get("intent") === "modify" ? "modify" as const : undefined,
    plan: query.get("plan") || "",
    conversation: query.get("conversation") || undefined,
  };
}
// Preserve unrelated parameters (for example language), and clear context from the screen being left.
export function dashboardSearch(search: string, tab: DashboardTab, shop: string, screen?: string, article?: string, conversation?: string, recordId?: string) {
  const query = new URLSearchParams(search);
  for (const key of ["tab", "shop", "calendar", "screen", "article", "customer", "customerView", "inquiry", "request", "intent", "plan", "conversation"]) query.delete(key);
  query.set("tab", tab);
  if (shop) query.set("shop", shop);
  if (tab === "try" && screen) query.set("screen", screen);
  if (tab === "try" && article) query.set("article", article);
  if (tab === "assistant" && conversation) query.set("conversation", conversation);
  if (recordId && (tab === "customers" || tab === "inquiries")) query.set(tab === "customers" ? "customer" : "inquiry", recordId);
  return `?${query}`;
}
export function useDashboardNavigation(search: string, initialTab: string, browser: boolean) {
  const [currentSearch, setCurrentSearch] = useState(search);
  const [scrollRequest, setScrollRequest] = useState(0);
  const latestSearch = useRef(search);
  // Reset after the destination and mobile menu have rendered. Popstate keeps native restoration.
  useLayoutEffect(() => {
    if (scrollRequest) window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [scrollRequest]);
  useEffect(() => { latestSearch.current = search; setCurrentSearch(search); }, [search]);
  useEffect(() => {
    if (!browser) return;
    const pop = () => {
      // Back/forward has already moved the URL; restore it when the owner keeps the unfinished AI work.
      if (!confirmLeave()) { window.history.pushState(window.history.state, "", `/${latestSearch.current}`); return; }
      latestSearch.current = location.search; setCurrentSearch(location.search);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [browser]);
  return {
    route: dashboardRoute(currentSearch, browser ? "dashboard" : dashboardTab(initialTab)),
    search: currentSearch,
    /** Returns false when the owner chose to stay on the current screen. */
    visit(tab: DashboardTab, shop: string, screen?: string, article?: string, replace = false, conversation?: string, recordId?: string) {
      const next = dashboardSearch(latestSearch.current, tab, shop, screen, article, conversation, recordId);
      const previousQuery = new URLSearchParams(latestSearch.current), nextQuery = new URLSearchParams(next);
      previousQuery.sort(); nextQuery.sort();
      // Choosing the current tab again still returns to the top; only real moves need confirmation.
      if (previousQuery.toString() !== nextQuery.toString() && !replace && !confirmLeave()) return false;
      setScrollRequest(value => value + 1);
      if (previousQuery.toString() === nextQuery.toString()) return true;
      if (browser) window.history[replace ? "replaceState" : "pushState"](window.history.state, "", `/${next}`);
      latestSearch.current = next;
      setCurrentSearch(next);
      return true;
    },
  };
}
