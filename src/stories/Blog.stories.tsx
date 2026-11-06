import React from "react";
import {within,userEvent} from "storybook/test";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";
import { tr } from "../../shared/i18n";

const meta = {
  title: "運営/ブログ・お知らせ",
  component: Screen,
  parameters: { layout: "fullscreen" },
  render: (args, context) => <Screen key={`${context.id}:${args.scenario}`} {...args} />,
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const BlogEditor: Story = {
  name: "ブログ・お知らせの編集",
  args: { scenario: "blog-editor" },
};

export const Access: Story = {
  name: "記事別のPV・ユニークブラウザ数",
  args: { scenario: "blog-editor" },
  play: async ({ canvasElement }) => { await userEvent.click(await within(canvasElement).findByText(tr("お店のアクセス数"))); },
};

export const TextArticle: Story = {name:"テキストで作成・画像を追加",args:{scenario:"blog-editor"}};

export const WriteArticle: Story = {name:"自分で作成・テキスト入力",args:{scenario:"blog-editor"}};

export const RichTextArticle: Story = {name:"リッチテキストで作成",args:{scenario:"blog-editor"},play:async({canvasElement})=>{await userEvent.click(await within(canvasElement).findByRole("button",{name:tr("リッチテキスト")}));}};

export const AiArticle: Story = {name:"AIに依頼・画像とファイル参照",args:{scenario:"blog-editor"},play:async({canvasElement})=>{const canvas=within(canvasElement);await userEvent.type(await canvas.findByLabelText(tr("タイトル")),tr("秋の新しいデザインができました"));await userEvent.type(await canvas.findByRole("textbox",{name:tr("記事の本文")}),tr("秋の新しいデザインができました"));await userEvent.click(await canvas.findByRole("button",{name:tr("下書き保存")}));await userEvent.click(await canvas.findByRole("button",{name:tr("AIで修正")}));}};
