import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";
import { openEditingChat } from "./story-helpers";

const meta = {
  title: "運営/画面の編集/画面を試す・編集",
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

export const LocalEditorNew: Story = {
  name: "仮公開したお店をローカルで試す",
  args: { scenario: "local-editor-new" },
};

export const CustomPagesEditor: Story = {
  name: "追加ページ・画面ツリーと個別反映",
  args: { scenario: "local-editor-pages" },
};
