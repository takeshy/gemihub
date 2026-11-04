import React from "react";
import { setLocaleResolver, parseLocale } from "../shared/i18n";
import type { Preview } from "@storybook/react-vite";
import "../src/style.css";
const storyLocale = (globals: Record<string, unknown>) => parseLocale(new URLSearchParams(location.search).get("lang")) || parseLocale(globals.locale) || "ja";
// Editor drafts and mock chats are saved in localStorage with text in the language they were made in.
// Drop them when the language changes, so a story never mixes Japanese and English fixtures.
const localeMarker = "gemihub:storybook-locale";
const languageState = /^gemihub:(local-preview|storybook-chats):/;
function resetStateOnLanguageChange(locale: string) {
  try {
    if (localStorage.getItem(localeMarker) === locale) return;
    for (const key of Object.keys(localStorage)) if (languageState.test(key)) localStorage.removeItem(key);
    localStorage.setItem(localeMarker, locale);
  } catch { /* Storage can be unavailable; stories still render from fresh fixtures. */ }
}
const preview: Preview = {
  initialGlobals: { locale: "ja" },
  // Runs before story loaders, which build fixtures with tr(): set the language first.
  loaders: [async context => {
    const locale = storyLocale(context.globals);
    setLocaleResolver(() => locale);
    resetStateOnLanguageChange(locale);
    return {};
  }],
  globalTypes: {
    locale: { description: "Language / 言語", toolbar: { icon: "globe", items: [{ value: "ja", title: "日本語" }, { value: "en", title: "English" }], dynamicTitle: true } },
  },
  decorators: [(Story, context) => {
    const locale = storyLocale(context.globals);
    resetStateOnLanguageChange(locale);
    setLocaleResolver(() => locale);
    document.documentElement.lang = locale;
    return React.createElement("div", { key: locale }, React.createElement(Story));
  }],
  parameters: {
    layout: "fullscreen",
    controls: { disable: true },
    options: {
      storySort: {
        // Mirrors the app: the owner's dashboard (sidebar order), then what customers see.
        order: [
          "運営", [
            "はじめる", ["はじめる前", "サービス紹介", "旧環境からの引き継ぎ"],
            "お店づくり", ["はじめてのお店づくり", "仮公開・本番公開", "AIに変更を依頼"],
            "画面の編集", ["画面を試す・編集", "同期と競合", "版履歴"],
            "相談・質問",
            "設定", ["お店の基本情報", "国・タイムゾーン", "曜日別の営業時間", "メニュー・料金", "メニュー画像", "スタッフ・勤務", "カレンダー連携", "画像管理", "AIで設定", "公開の設定", "データ管理", "撮影用の初期化"],
            "予約・お客様", ["予約管理", "お客様", "お問い合わせ", "お支払いと返金", "キャンセル枠の予約"],
            "ブログ・お知らせ",
            "使い方",
          ],
          "お客様の画面", ["会員登録・ログイン", "メール認証", "予約・お問い合わせ", "追加メニューの予約", "予約完了", "お支払い・返金", "返金期限", "キャンセルとお得な空き枠", "マイページ", "追加ページ", "ブログ・お知らせ"],
        ],
      },
    },
  },
};
export default preview;
