import type { KeyboardEvent } from "react";

/** Keep shortcuts on the same submission path as the Send button. */
export function submitOnShortcut(event: KeyboardEvent<HTMLTextAreaElement>, send?: () => void) {
  if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey) || event.altKey || event.repeat || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
  event.preventDefault();
  if (event.currentTarget.disabled || !event.currentTarget.value.trim()) return;
  if (send) { send(); return; }
  const form = event.currentTarget.form;
  const button = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (button && !button.disabled) form!.requestSubmit(button);
}
