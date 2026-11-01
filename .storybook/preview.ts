import type { Preview } from "@storybook/react-vite";
import "../src/style.css";
const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    controls: { disable: true },
    options: {
      storySort: {
        order: ["運営", ["はじめる", "お店づくり", "予約管理", "お問い合わせ", "お客様", "お店の基本情報", "メニュー・料金", "スタッフ・勤務", "画像管理", "メニュー画像", "家族・スタッフ", "データ管理", "公開・連携", "*"], "お客様の会員登録", "お客様の予約", "お客様のマイページ", "お客様の追加ページ", "ブログ・お知らせ", "カレンダー連携", "使い方"],
      },
    },
  },
};
export default preview;
