import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { StaticStorefront } from "../StaticStorefront";
import { sample } from "../../server/domain";
import { exampleTheme } from "./themes";

const config = { ...structuredClone(sample), appearance: { accent: "sage" as const, layout: "standard" as const, imageUrl: "", theme: exampleTheme } };
const post = { id: "winter", category: "blogs" as const, date: "2030-01-02", slug: "winter", title: "Winter designs", excerpt: "Seasonal ideas from our atelier.", body: "## Winter collection\n\nA quiet moment for yourself.", publishedAt: "2030-01-02T00:00:00Z" };
const meta = {
  title: "公開ページ/静的HTML",
  component: StaticStorefront,
  args: { config, base: "/s/sample", view: { kind: "home", posts: [post] } },
  // Links open generated HTML or authenticated operation screens in the real site.
  render: args => <div onClick={event => { if ((event.target as HTMLElement).closest("a")) event.preventDefault(); }}><StaticStorefront {...args} /></div>,
} satisfies Meta<typeof StaticStorefront>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Home: Story = { name: "公開トップ・API不要" };
export const Archive: Story = { name: "記事一覧", args: { view: { kind: "archive", category: "blogs", posts: [post] } } };
export const Article: Story = { name: "記事本文", args: { view: { kind: "article", post } } };
export const CustomPage: Story = { name: "固定ページ", args: { view: { kind: "page", page: { id: "story", slug: "story", title: "Our story", navigationLabel: "Story", body: "<p>Welcome to our atelier.</p>", layout: "standard", imageUrl: "" } } } };
export const Provisional: Story = { name: "本人限定の仮公開", args: { provisional: true } };
