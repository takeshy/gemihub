import React, { useState } from "react";
import { within, userEvent } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { CustomerEmailLogin } from "../CustomerEmailLogin";
import { ApiProvider, type ApiClient } from "../api";
import { tr } from "../../shared/i18n";

const mock: ApiClient = async <T,>(path: string) => (path.endsWith("/info") ? { email: "customer@example.com", shopName: tr("nail atelier 凪") } : { ok: true, redirectTo: "/" }) as T;
function EmailLoginStory() {
  const [open, setOpen] = useState(true);
  return <ApiProvider value={mock}><button onClick={() => setOpen(true)}>{tr("会員登録")}</button><CustomerEmailLogin base="/api/public/sample" shopName={tr("nail atelier 凪")} googleAuthUrl="/auth/google?shop=sample" open={open} onClose={() => setOpen(false)}/></ApiProvider>;
}
const meta = { title: "お客様の画面/メール認証", component: EmailLoginStory, parameters: { layout: "fullscreen" } } satisfies Meta<typeof EmailLoginStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Email: Story = { name: "メールアドレスの入力" };
export const Sent: Story = { name: "認証メール送信後", play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.type(await canvas.findByLabelText(tr("メールアドレス")), "customer@example.com");
  await userEvent.click(await canvas.findByRole("button", { name: tr("認証メールを送る") }));
  await canvas.findByText(tr("メールを確認してください"));
} };
export const Confirmation: Story = { name: "メールアドレスを確認してログイン", beforeEach: () => {
  const previous = location.hash;
  history.replaceState(history.state, "", `${location.pathname}${location.search}#email-login=storybook`);
  return () => history.replaceState(history.state, "", location.pathname + location.search + previous);
} };
