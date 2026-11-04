import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";
import { sendFirstMessage } from "./story-helpers";
import { getLocale } from "../../shared/i18n";

const meta = {
  title: "運営/お店づくり/AIに変更を依頼",
  component: Screen,
  parameters: { layout: "fullscreen" },
  render: (args) => <Screen key={args.scenario} {...args} />,
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Changes: Story = {
  name: "公開後の変更依頼",
  args: { scenario: "changes" },
};

export const ShopSpecification: Story = { name: "トップの変更履歴・現在のお店の設定とAI相談", args: {scenario: "system"} };

export const AIPageBuilder: Story = { name: "相談・修正・新ページ作成を選ぶ", args: { scenario: "page-builder" } };

export const ProposalFailure: Story = { name: "変更案の作成失敗・チャットから再試行", tags: ["expected-alert"], args: { scenario: "proposal-failure" }, play: ({ canvasElement }) => sendFirstMessage(canvasElement, getLocale() === "en" ? "I want to add a foot care menu" : "メニューにフットケアを追加したい") };

export const QuestionFailure: Story = { name: "メッセージ送信失敗・下書きを復元", tags: ["expected-alert"], args: { scenario: "question-failure" }, play: ({ canvasElement }) => sendFirstMessage(canvasElement, getLocale() === "en" ? "I want to open until 7 pm" : "営業時間を19時までにしたい") };
