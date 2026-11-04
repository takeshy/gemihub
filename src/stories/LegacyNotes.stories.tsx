import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { LegacyNotes } from "../LegacyNotes";
const meta = { title: "運営/はじめる/旧環境からの引き継ぎ", component: LegacyNotes,
  parameters: { layout: "fullscreen" }, args: { onCheck: () => undefined },
  decorators: [(Story) => <main><Story /></main>],
} satisfies Meta<typeof LegacyNotes>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Notice: Story = { name: "旧環境からの引き継ぎ" };
