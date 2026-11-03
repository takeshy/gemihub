import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { tr } from "../../shared/i18n";
import { ApiProvider, type ApiClient } from "../api";
import { ShopReset } from "../ShopReset";
import "../style.css";

function Preview({ fail = false, pending = false }: { fail?: boolean; pending?: boolean }) {
  const [done, setDone] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const api: ApiClient = async <T,>() => {
    setAttempts(value => value + 1);
    if (pending) return new Promise<T>(() => {});
    if (fail && attempts === 0) throw new Error(tr("操作できませんでした"));
    return { ok: true } as T;
  };
  return <ApiProvider value={api}><div style={{ padding: 24 }}>{done ? <p role="status">{tr("はじめる")}</p> : <ShopReset shopId="recording-shop" navigate={() => setDone(true)} />}</div></ApiProvider>;
}
const meta = {
  title: "運営/撮影用の初期化", component: Preview, parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Preview>;
export default meta;
type Story = StoryObj<typeof meta>;
const open = async (canvasElement: HTMLElement) => {
  canvasElement.querySelector<HTMLButtonElement>("button")!.click();
  await new Promise(resolve => setTimeout(resolve, 0));
};
export const Confirmation: Story = { name: "Google連携を維持して初期化を確認", play: async ({ canvasElement }) => open(canvasElement) };
export const Retry: Story = { name: "初期化失敗から同じ処理を再試行", args: { fail: true }, play: async ({ canvasElement }) => { await open(canvasElement); canvasElement.querySelector<HTMLButtonElement>(".danger")!.click(); } };
export const Pending: Story = { name: "初期化中は操作を待つ", args: { pending: true }, play: async ({ canvasElement }) => { await open(canvasElement); canvasElement.querySelector<HTMLButtonElement>(".danger")!.click(); } };
