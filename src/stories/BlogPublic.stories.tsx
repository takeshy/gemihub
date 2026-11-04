import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";

const meta = {
  title: "お客様の画面/ブログ・お知らせ",
  component: Screen,
  parameters: { layout: "fullscreen" },
  render: (args) => <Screen key={args.scenario} {...args} />,
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const BlogArchive: Story = {
  name: "ブログ一覧",
  args: { scenario: "blog-archive" },
};

export const BlogArticle: Story = {
  name: "ブログ記事",
  args: { scenario: "blog-article" },
};

export const Announcements: Story = {
  name: "お知らせ一覧",
  args: { scenario: "announcement-archive" },
};

export const EmptyBlog: Story = {
  name: "記事がない状態",
  args: { scenario: "empty-blog" },
};
