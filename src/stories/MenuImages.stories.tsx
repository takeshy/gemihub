import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";
const meta = { title: "運営/設定/メニュー画像", component: Screen, parameters: { layout: "fullscreen" }, render: args => <Screen key={args.scenario} {...args} /> } satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Editor: Story = { name: "画像の登録・差し替え・解除", args: { scenario: "menu-images" } };
export const Reservation: Story = { name: "画像付きメニューの予約画面", args: { scenario: "menu-images-public" } };
