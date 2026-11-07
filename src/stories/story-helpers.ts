import { tr } from "../../shared/i18n";

export async function openEditingChat({ canvasElement }: { canvasElement: HTMLElement }) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const button = canvasElement.querySelector<HTMLButtonElement>(".editor-pen-button, .visual-request > button");
    if (button && !button.disabled) { if (button.getAttribute("aria-pressed") !== "true") button.click(); return; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("The editing chat trigger did not appear");
}

/** Drives the chat to the failing request, so the story opens on the error and its recovery action. */
export async function sendFirstMessage(canvasElement: HTMLElement, text: string, resultSelector = '[role="alert"]') {
  const find = <T extends Element>(selector: string, match?: (element: T) => boolean) => new Promise<T>((resolve, reject) => {
    let attempt = 0;
    const tick = () => {
      const found = [...canvasElement.querySelectorAll<T>(selector)].find(element => !match || match(element));
      if (found && !(found as unknown as HTMLButtonElement).disabled) resolve(found);
      else if (++attempt > 100) reject(new Error(`${selector} did not appear`));
      else setTimeout(tick, 50);
    };
    tick();
  });
  (await find<HTMLButtonElement>(".panel button.primary, .panel button", button => button.textContent === tr("はじめる"))).click();
  const composer = await find<HTMLTextAreaElement>(".chat-composer textarea");
  // React tracks the native value setter, so set it that way before dispatching input.
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(composer, text);
  composer.dispatchEvent(new Event("input", { bubbles: true }));
  (await find<HTMLButtonElement>(".chat-composer button[type=submit], .chat-composer button", button => button.textContent === tr("送信"))).click();
  await find(resultSelector);
}
