import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";
const meta = { title: "運営/設定/国・タイムゾーン", component: Screen, parameters: {layout:"fullscreen"}, render: args => <Screen key={args.scenario} {...args} /> } satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;
export const UnitedStates: Story = {name:"米国のお店・国とタイムゾーン",args:{scenario:"us-settings"}};
export const DollarPrices: Story = {name:"米ドルの小数料金",args:{scenario:"us-menus"}};
export const Booking: Story = {name:"米国のお店・現地時間で予約",args:{scenario:"us-booking"}};
