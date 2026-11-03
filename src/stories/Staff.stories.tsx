import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";

const meta = {
  title: "運営/スタッフ・勤務",
  component: Screen,
  parameters: { layout: "fullscreen" },
  render: (args) => <Screen key={args.scenario} {...args} />,
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Staff: Story = { name: "スタッフ・勤務の保存", args: { scenario: "manage-staff" } };

export const Login: Story = { name: "スタッフのGoogleログイン・カレンダー許可", args: { scenario: "staff-login" } };

export const OwnerCalendar: Story = { name: "店主1人・追加スタッフなし", args: { scenario: "owner-only" } };
export const OwnerShifts: Story = { name: "店主の勤務日・勤務時間・対応メニュー", args: { scenario: "owner-shifts" } };

export const MyPhoto: Story = { name: "スタッフ本人の写真登録", args: { scenario: "calendar-member" } };
