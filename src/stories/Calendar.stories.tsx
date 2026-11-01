import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";

const meta = {
  title: "カレンダー連携",
  component: Screen,
  parameters: { layout: "fullscreen" },
  render: (args) => <Screen key={args.scenario} {...args} />,
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const CalendarDisconnected: Story = {
  name: "Calendar 未連携・ログイン時に許可",
  args: { scenario: "calendar-disconnected" },
};

export const CalendarConnected: Story = {
  name: "Calendar 連携中",
  args: { scenario: "calendar-connected" },
};

export const CalendarMember: Story = {
  name: "Calendar スタッフ本人の連携",
  args: { scenario: "calendar-member" },
};

export const CalendarMissingStaff: Story = {
  name: "Calendar 担当スタッフ削除後",
  args: { scenario: "calendar-missing-staff" },
};
