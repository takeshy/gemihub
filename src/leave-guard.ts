import { useEffect, useRef } from "react";

// Work that would be lost if its screen unmounts, newest last.
const guards: { message: () => string | undefined }[] = [];
let confirmedUntil = 0;

/** Ask before leaving while a guard reports unsaved work. Returns whether navigation may continue. */
export function confirmLeave(): boolean {
  // One confirmed move can pass through several navigation layers (screen tree → tab route) in the same task.
  if (Date.now() < confirmedUntil) return true;
  const message = guards.map(guard => guard.message()).filter(Boolean).at(-1);
  if (!message) return true;
  if (!window.confirm(message)) return false;
  confirmedUntil = Date.now() + 500;
  return true;
}

/** Register a leave confirmation while `message` is set; also covers reload and closing the tab. */
export function useLeaveGuard(message: string | undefined) {
  const latest = useRef(message);
  latest.current = message;
  useEffect(() => {
    const guard = { message: () => latest.current };
    guards.push(guard);
    return () => { guards.splice(guards.indexOf(guard), 1); };
  }, []);
  useEffect(() => {
    if (!message) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [!!message]);
}
