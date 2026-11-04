import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { AssistantAnswer } from "../AssistantAnswer";
import { getLocale } from "../../shared/i18n";

const meta = {
  title: "運営/相談・質問",
  component: AssistantAnswer,
  // Sample answers are written per language, as the AI would answer in the owner's language.
  render: (args, { parameters }) => <section className="panel assistant"><h2>AI</h2><div className="chat-log assistant-log"><article className="chat-message chat-message-assistant"><AssistantAnswer {...args} text={getLocale() === "en" && parameters.english || args.text} /></article></div></section>,
} satisfies Meta<typeof AssistantAnswer>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Markdown: Story = {
  name: "見出し・箇条書き・表・コード",
  args: { text: "## キャンセル時の返金\n\n**予約時の条件**が適用されます。\n\n- マイページから予約を確認します。\n- キャンセル前に返金額を確認します。\n\n| 開始までの時間 | 返金率 |\n| --- | --- |\n| 72時間以上 | 100% |\n| 24時間以上 | 50% |\n| 24時間未満 | 0% |\n\n設定項目は `rules.payment.refundTiers` です。\n\n```text\n予約の条件を確認 → キャンセル → 返金\n```\n\n[使い方を開く](/manual)" },
  parameters: { english: "## Refunds on cancellation\n\nThe **terms at the time of booking** apply.\n\n- Check the booking on My page.\n- Check the refund amount before cancelling.\n\n| Time before start | Refund rate |\n| --- | --- |\n| 72 hours or more | 100% |\n| 24 hours or more | 50% |\n| Less than 24 hours | 0% |\n\nThe setting is `rules.payment.refundTiers`.\n\n```text\nCheck booking terms → Cancel → Refund\n```\n\n[Open the help](/manual)" },
};

export const PlainText: Story = {
  name: "通常の文章",
  args: { text: "営業時間は午前10時から午後7時です。\n\n水曜日は定休日です。" },
  parameters: { english: "We are open from 10 a.m. to 7 p.m.\n\nWe are closed on Wednesdays." },
};
