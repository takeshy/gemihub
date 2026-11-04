import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";

const meta = {
  title: "運営/設定/カレンダー連携",
  component: Screen,
  parameters: { layout: "fullscreen" },
  render: (args) => <Screen key={args.scenario} {...args} />,
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const CalendarDisconnected: Story = {
  name: "カレンダー未連携・ログイン時に許可",
  args: { scenario: "calendar-disconnected" },
};

export const CalendarConnected: Story = {
  name: "カレンダー連携中",
  args: { scenario: "calendar-connected" },
};

export const CalendarMember: Story = {
  name: "スタッフ本人のカレンダー連携",
  args: { scenario: "calendar-member" },
};

export const CalendarMissingStaff: Story = {
  name: "担当スタッフ削除後のカレンダー",
  args: { scenario: "calendar-missing-staff" },
};
