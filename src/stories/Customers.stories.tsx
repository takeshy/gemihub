import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";

const meta = {
  title: "運営/お客様",
  component: Screen,
  parameters: { layout: "fullscreen" },
  render: args => <Screen key={args.scenario} {...args} />,
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const List: Story = { name: "一覧・期間指定と自動集計", args: { scenario: "crm-list" } };
export const Detail: Story = { name: "詳細・種類の絞り込みと画像／ファイル添付", args: { scenario: "crm-detail" } };
export const Empty: Story = { name: "お客様ゼロ件", args: { scenario: "crm-empty" } };

export const Images: Story = { name: "画像一覧・ファイル名の編集と拡大", args: { scenario: "crm-images" } };
export const NoImages: Story = { name: "画像一覧・画像ゼロ件", args: { scenario: "crm-images-empty" } };

export const Inquiry: Story = { name: "お問い合わせの返信・対応状況", args: { scenario: "crm-inquiry" } };
