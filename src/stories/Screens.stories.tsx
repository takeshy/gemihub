import React, { useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { App } from "../App";
import { ApiProvider } from "../api";
import { createMockClient, scenarioProps, type Scenario } from "./mock";
function Screen({ scenario }: { scenario: Scenario }) {
  const client = useMemo(() => createMockClient(scenario), [scenario]);
  const [notice, setNotice] = useState("");
  const [route, setRoute] = useState<{ path: string; search: string }>();
  const navigate = (href: string) => {
    const url = new URL(href, location.origin);
    setRoute({ path: url.pathname, search: url.search });
    setNotice("");
  };
  return (
    <div
      onClickCapture={(event) => {
        const link = (event.target as HTMLElement).closest("a");
        if (
          link &&
          ["/", "/manual"].includes(link.getAttribute("href") || "")
        ) {
          event.preventDefault();
          navigate(link.getAttribute("href")!);
          return;
        }
        if (link?.hasAttribute("data-article-link")) {
          event.preventDefault();
          navigate(link.getAttribute("href")!);
          return;
        }
        if (link && !link.getAttribute("href")?.startsWith("#")) {
          event.preventDefault();
          setNotice(
            "Storybook では外部画面への移動を省略します。左の一覧から確認する画面を選んでください。",
          );
        }
      }}
    >
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      <ApiProvider value={client}>
        <App
          key={`${scenario}-${route?.path || ""}-${route?.search || ""}`}
          {...scenarioProps(scenario)}
          {...route}
          navigate={navigate}
        />
      </ApiProvider>
    </div>
  );
}
const meta = {
  title: "画面",
  component: Screen,
  parameters: { layout: "fullscreen" },
  render: (args) => <Screen key={args.scenario} {...args} />,
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Landing: Story = {
  name: "01 はじめる前",
  args: { scenario: "landing" },
};
export const Onboarding: Story = {
  name: "02 お店の情報を入力",
  args: { scenario: "onboarding" },
};
export const PlanReview: Story = {
  name: "03 プランを確認・承認",
  args: { scenario: "plan" },
};
export const Approved: Story = {
  name: "04 承認済み・公開前",
  args: { scenario: "approved" },
};
export const Preview: Story = {
  name: "05 モックプレビュー",
  args: { scenario: "preview" },
};
export const Changes: Story = {
  name: "06 公開後の変更依頼",
  args: { scenario: "changes" },
};
export const Reservations: Story = {
  name: "07 運営・予約管理",
  args: { scenario: "bookings" },
};
export const Inquiries: Story = {
  name: "08 運営・問い合わせ返信",
  args: { scenario: "inquiries" },
};
export const Team: Story = {
  name: "09 家族・スタッフの招待",
  args: { scenario: "team" },
};
export const Data: Story = {
  name: "10 データ・仕様・変更履歴",
  args: { scenario: "data" },
};
export const Settings: Story = {
  name: "11 独自ドメインの設定",
  args: { scenario: "settings" },
};
export const SyncError: Story = {
  name: "12 Google 連携の再送",
  args: { scenario: "sync-error" },
};
export const PublicationError: Story = {
  name: "13 公開の再試行",
  args: { scenario: "publication-error" },
};
export const Customer: Story = {
  name: "14 顧客・スタッフ指名の予約",
  args: { scenario: "reservation" },
};
export const AnyStaff: Story = {
  name: "15 顧客・指名なしの予約",
  args: { scenario: "any-reservation" },
};
export const MyPage: Story = {
  name: "16 顧客・マイページ",
  args: { scenario: "mypage" },
};
export const Contact: Story = {
  name: "17 顧客・お問い合わせ",
  args: { scenario: "contact" },
};
export const Anonymous: Story = {
  name: "18 顧客・ログイン前",
  args: { scenario: "anonymous" },
};

export const Manual: Story = {
  name: "19 使い方・画面付きマニュアル",
  args: { scenario: "manual" },
};

export const BlogEditor: Story = {
  name: "20 ブログ・お知らせの編集",
  args: { scenario: "blog-editor" },
};
export const BlogArchive: Story = {
  name: "21 顧客・ブログ一覧",
  args: { scenario: "blog-archive" },
};
export const BlogArticle: Story = {
  name: "22 顧客・ブログ記事",
  args: { scenario: "blog-article" },
};
export const Announcements: Story = {
  name: "23 顧客・お知らせ一覧",
  args: { scenario: "announcement-archive" },
};
export const EmptyBlog: Story = {
  name: "24 顧客・記事がない状態",
  args: { scenario: "empty-blog" },
};

export const ShopSystem: Story = { name: "25 お店の仕組み図と質問", args: {scenario: "system"} };
export const PenPreview: Story = { name: "26 プレビューへのペン入力", args: {scenario: "visual-preview"} };
export const PenLive: Story = { name: "27 公開ページへのペン入力", args: {scenario: "visual-live"} };
