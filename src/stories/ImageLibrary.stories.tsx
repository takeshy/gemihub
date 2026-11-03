import React from "react";
import { tr } from "../../shared/i18n";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { within, userEvent } from "storybook/test";
import { Screen } from "./Screen";
const meta = { title: "運営/画像管理", component: Screen, parameters: { layout: "fullscreen" }, render: args => <Screen key={args.scenario} {...args} /> } satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;
async function openPicker(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole("button", { name: tr("はじめる") }));
  await userEvent.click(await canvas.findByRole("button", { name: tr("画像を添付") }));
  return within(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: tr("依頼の画像を選ぶ") }));
}
export const Library: Story = { name: "管理画像・アップロード・使用中の画面", args: { scenario: "image-library" }, play: async ({ canvasElement }) => { await openPicker(canvasElement); } };
export const Generate: Story = { name: "文章で画像生成・参考画像", args: { scenario: "image-library-generation" }, play: async ({ canvasElement }) => { const picker = await openPicker(canvasElement); await userEvent.click(picker.getByRole("button", { name: tr("AIで生成") })); await userEvent.click(picker.getByRole("button", { name: new RegExp(tr("文章で依頼")) })); await userEvent.type(picker.getByLabelText(tr("生成したい画像")), "お店の紹介に使う、明るい窓辺と季節の花の画像"); } };
export const GenerateMethods: Story = { name: "画像生成の依頼方法を選ぶ", args: { scenario: "image-library-generation" }, play: async ({ canvasElement }) => { const picker = await openPicker(canvasElement); await userEvent.click(picker.getByRole("button", { name: tr("AIで生成") })); } };
export const GenerateVoice: Story = { name: "音声で画像生成・内容を確認", args: { scenario: "image-library-generation" }, play: async ({ canvasElement }) => { const picker = await openPicker(canvasElement); await userEvent.click(picker.getByRole("button", { name: tr("AIで生成") })); await userEvent.click(picker.getByRole("button", { name: new RegExp(tr("音声で依頼")) })); } };
export const GenerateResult: Story = { name: "生成した画像を確認・さらに依頼・これでOK", args: { scenario: "image-library-generation" }, play: async ({ canvasElement }) => { const picker = await openPicker(canvasElement); await userEvent.click(picker.getByRole("button", { name: tr("AIで生成") })); await userEvent.click(picker.getByRole("button", { name: new RegExp(tr("文章で依頼")) })); await userEvent.type(picker.getByLabelText(tr("生成したい画像")), "明るい窓辺と花"); await userEvent.click(picker.getByRole("button", { name: tr("生成して結果を確認") })); await picker.findByRole("heading", { name: tr("生成した画像を確認") }); } };
export const RequestPicker: Story = { name: "依頼に管理画像を添付", args: { scenario: "image-library" }, play: async ({ canvasElement }) => { await openPicker(canvasElement); } };
export const Empty: Story = { name: "画像ゼロ件", args: { scenario: "image-library-empty" }, play: async ({ canvasElement }) => { await openPicker(canvasElement); } };
export const UploadRetry: Story = { name: "アップロードを再試行", args: { scenario: "image-library-retry" }, play: async ({ canvasElement }) => { await openPicker(canvasElement); } };
export const Page: Story = { name: "管理画像を使ったヘッダーと追加ページ", args: { scenario: "image-page" } };
