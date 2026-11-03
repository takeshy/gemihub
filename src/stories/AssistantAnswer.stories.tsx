import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { AssistantAnswer } from "../AssistantAnswer";

const meta = {
  title: "運営/相談・質問/回答",
  component: AssistantAnswer,
  render: args => <section className="panel assistant"><h2>AI</h2><div className="chat-log assistant-log"><article className="chat-message chat-message-assistant"><AssistantAnswer {...args} /></article></div></section>,
} satisfies Meta<typeof AssistantAnswer>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Markdown: Story = {
  name: "見出し・箇条書き・表・コード",
  args: { text: "## キャンセル時の返金\n\n**予約時の条件**が適用されます。\n\n- マイページから予約を確認します。\n- キャンセル前に返金額を確認します。\n\n| 開始までの時間 | 返金率 |\n| --- | --- |\n| 72時間以上 | 100% |\n| 24時間以上 | 50% |\n| 24時間未満 | 0% |\n\n設定項目は `rules.payment.refundTiers` です。\n\n```text\n予約の条件を確認 → キャンセル → 返金\n```\n\n[使い方を開く](/manual)" },
};

export const PlainText: Story = {
  name: "通常の文章",
  args: { text: "営業時間は午前10時から午後7時です。\n\n水曜日は定休日です。" },
};
