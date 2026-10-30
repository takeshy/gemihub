import type { Preview } from "@storybook/react-vite";
import "../src/style.css";
const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    controls: { disable: true },
    options: {
      storySort: {
        order: ["はじめる", "お店づくり", "運営", "お客様の予約", "ブログ・お知らせ", "カレンダー連携", "使い方"],
      },
    },
  },
};
export default preview;
