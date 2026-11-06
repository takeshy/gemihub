import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";
import { within, userEvent } from "storybook/test";
import { tr } from "../../shared/i18n";

const meta = {
  title: "運営/予約・お客様/お客様",
  component: Screen,
  parameters: { layout: "fullscreen" },
  render: args => <Screen key={args.scenario} {...args} />,
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const List: Story = { name: "一覧・期間指定と自動集計", args: { scenario: "crm-list" } };
export const Traffic: Story = { name: "匿名ユーザーを含む日別アクセス数", args: { scenario: "crm-list" }, play: async ({ canvasElement }) => { await userEvent.click(await within(canvasElement).findByText(tr("お店のアクセス数"))); } };
export const Detail: Story = { name: "詳細・種類の絞り込みと画像／ファイル添付", args: { scenario: "crm-detail" } };
export const Activity: Story = { name: "行動履歴・予約とキャンセルの経過", args: { scenario: "crm-detail" }, play: async ({ canvasElement }) => { (await within(canvasElement).findByRole("region", { name: tr("行動履歴") })).scrollIntoView({ block: "start" }); } };
export const ActivityLong: Story = { name: "行動履歴・10件ずつページ切替", args: { scenario: "crm-activity-long" }, play: async ({ canvasElement }) => { (await within(canvasElement).findByRole("region", { name: tr("行動履歴") })).scrollIntoView({ block: "start" }); } };
export const Empty: Story = { name: "お客様ゼロ件", args: { scenario: "crm-empty" } };

export const Images: Story = { name: "画像一覧・ファイル名の編集と拡大", args: { scenario: "crm-images" } };
export const NoImages: Story = { name: "画像一覧・画像ゼロ件", args: { scenario: "crm-images-empty" } };

export const Inquiry: Story = { name: "お問い合わせの返信・対応状況", args: { scenario: "crm-inquiry" } };

export const PagedList: Story = { name: "お客様一覧・複数ページ", args: { scenario: "crm-list-long" } };
export const PagedDetail: Story = { name: "予約・お問い合わせ・タイムラインのページ切替", args: { scenario: "crm-pagination" } };
export const PagedInquiry: Story = { name: "別ページのお問い合わせを直接開く", args: { scenario: "crm-inquiry-long" } };
