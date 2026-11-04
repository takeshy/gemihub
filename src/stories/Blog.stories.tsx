import React from "react";
import {within,userEvent} from "storybook/test";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";

const meta = {
  title: "運営/ブログ・お知らせ",
  component: Screen,
  parameters: { layout: "fullscreen" },
  render: (args) => <Screen key={args.scenario} {...args} />,
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const BlogEditor: Story = {
  name: "ブログ・お知らせの編集",
  args: { scenario: "blog-editor" },
};

export const WriteArticle: Story = {name:"自分で作成・見たまま編集",args:{scenario:"blog-editor"},play:async({canvasElement})=>{await userEvent.click(await within(canvasElement).findByRole("button",{name:/^自分で作成する/}));}};

export const AiArticle: Story = {name:"AIに依頼・画像とファイル参照",args:{scenario:"blog-editor"},play:async({canvasElement})=>{await userEvent.click(await within(canvasElement).findByRole("button",{name:/^AIに依頼する/}));}};
