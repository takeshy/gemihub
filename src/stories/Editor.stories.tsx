import { tr } from "../../shared/i18n";
import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";
import { openEditingChat } from "./story-helpers";

const meta = {
  title: "運営/画面の編集/AIとお店をつくる",
  component: Screen,
  parameters: { layout: "fullscreen" },
  render: (args) => <Screen key={args.scenario} {...args} />,
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const LocalEditor: Story = {
  name: "画面を試す・ローカル編集と反映",
  args: { scenario: "local-editor" },
};

export const ScreenEditingChat: Story = {
  name: "画面を見ながら赤ペンとチャットで修正",
  args: { scenario: "local-editor" },
  play: openEditingChat,
};

export const NewsHeadingChat: Story = {
  name: "お便りの見出しを修正チャットで変更",
  args: { scenario: "local-editor" },
  play: async ({ canvasElement }) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const button = [...canvasElement.querySelectorAll<HTMLButtonElement>('button[role="treeitem"]')].find(button => button.querySelector(".tree-name")?.textContent === tr("マイページ"));
      if (button) { button.click(); break; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    await openEditingChat({ canvasElement });
    for (let attempt = 0; attempt < 100; attempt++) {
      const composer = document.querySelector<HTMLTextAreaElement>(".visual-chat-panel textarea");
      if (composer && !composer.disabled) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(composer, tr("お便りの見出しを『お店の最新ニュース』に変えてください。"));
        composer.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 50));
        composer.form?.requestSubmit();
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error("The editing chat composer did not appear");
  },
};

export const LocalEditorNew: Story = {
  name: "仮公開したお店をローカルで試す",
  args: { scenario: "local-editor-new" },
};

export const CustomPagesEditor: Story = {
  name: "追加ページ・画面ツリーと個別反映",
  args: { scenario: "local-editor-pages" },
};

export const SharedComponents: Story = {
  name: "共通部品を分けたページ全体",
  args: { scenario: "whole-page-editor" },
};
export const SharedComponentsContrast: Story = {
  name: "青系の共通部品とページ全体",
  args: { scenario: "whole-page-editor-contrast" },
};
