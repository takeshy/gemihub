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

export const Charts: Story = {
  name: "回答の棒グラフ・折れ線グラフ",
  args: { text: "スタッフ別売上と日別推移です。金額は施術終了済みの予約に基づきます。\n\n```mermaid\nxychart-beta\ntitle \"スタッフ別売上\"\nx-axis [\"あおい\", \"はる\"]\ny-axis \"JPY\" 0 --> 60000\nbar [55000, 42000]\n```\n\n```mermaid\nxychart-beta\ntitle \"日別売上\"\nx-axis [\"11/01\", \"11/02\", \"11/03\", \"11/04\", \"11/05\"]\ny-axis \"JPY\" 0 --> 30000\nline \"あおい\" [7000, 10000, 8000, 13000, 17000]\nline \"はる\" [5000, 8000, 7000, 11000, 11000]\n```\n\n根拠：予約の完了率・スタッフ別売上（logs:booking-analytics）。" },
  parameters: { english: "Staff sales and daily trends, based on appointments whose service has ended.\n\n```mermaid\nxychart-beta\ntitle \"Staff sales\"\nx-axis [\"Aoi\", \"Haru\"]\ny-axis \"JPY\" 0 --> 60000\nbar [55000, 42000]\n```\n\n```mermaid\nxychart-beta\ntitle \"Daily sales\"\nx-axis [\"11/01\", \"11/02\", \"11/03\", \"11/04\", \"11/05\"]\ny-axis \"JPY\" 0 --> 30000\nline \"Aoi\" [7000, 10000, 8000, 13000, 17000]\nline \"Haru\" [5000, 8000, 7000, 11000, 11000]\n```\n\nSource: Booking conversion and staff sales (logs:booking-analytics)." },
};

export const BookingFlow: Story = {
  name: "回答の予約フロー図",
  args: { text: "予約が確定するまでの流れです。\n\n```mermaid\nflowchart LR\na[予約ページ] --> b[ログイン]\nb --> c[メニューと日時を選択]\nc --> d[予約完了]\n```\n\n根拠：現在のお店の設定（spec.md）。" },
  parameters: { english: "The steps to confirm a booking.\n\n```mermaid\nflowchart LR\na[Booking page] --> b[Sign in]\nb --> c[Select menu and time]\nc --> d[Booking completed]\n```\n\nSource: Current shop settings (spec.md)." },
};

export const InvalidDiagram: Story = {
  name: "図の表示失敗・元データを確認",
  args: { text: "図を表示できない場合も、説明と元のデータを確認できます。\n\n```mermaid\nflowchart LR\na[Incomplete\n```" },
  parameters: { english: "If a diagram cannot be displayed, its explanation and original data remain available.\n\n```mermaid\nflowchart LR\na[Incomplete\n```" },
};
