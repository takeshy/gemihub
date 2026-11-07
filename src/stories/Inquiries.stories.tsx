import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { within, userEvent } from "storybook/test";
import { tr } from "../../shared/i18n";
import { Screen } from "./Screen";

const meta = {
  title: "運営/予約・お客様/お問い合わせ",
  component: Screen,
  parameters: { layout: "fullscreen" },
  render: (args) => <Screen key={args.scenario} {...args} />,
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Inquiries: Story = {
  name: "問い合わせ返信",
  args: { scenario: "inquiries" },
};

export const Pagination: Story = { name: "一覧・複数ページ", args: { scenario: "inquiries-long" } };

export const Board: Story = { name: "カンバン・4つの対応状況", args: { scenario: "inquiries-board" }, play: async ({ canvasElement }) => { await userEvent.click(await within(canvasElement).findByRole("button", { name: tr("カンバン表示") })); } };
export const BoardPages: Story = { name: "カンバン・列ごとのページ切替", args: { scenario: "inquiries-board-long" }, play: Board.play };
export const History: Story = { name: "電話・メモ・メールのやりとり", args: { scenario: "inquiries-history" }, play: async ({ canvasElement }) => { const canvas = within(canvasElement); await userEvent.click((await canvas.findAllByRole("button", { name: tr("{0}のお問い合わせを開く", tr("佐藤 みどり")) }))[0]); } };
export const Manual: Story = { name: "手動で新規作成・メールなしの受付", args: { scenario: "inquiries-manual" }, play: async ({ canvasElement }) => { await userEvent.click(await within(canvasElement).findByRole("button", { name: tr("お問い合わせを新規作成") })); } };

export const Attachments: Story = { name: "お客様と社内メモの添付", args: { scenario: "inquiries-attachments" }, play: History.play };
export const Archive: Story = { name: "古い完了案件を期間指定で表示", args: { scenario: "inquiries-archive" }, play: Board.play };
