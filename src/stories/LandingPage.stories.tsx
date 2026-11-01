import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { LandingPage } from "../LandingPage";
import "../landing.css";

const meta = {
  title: "運営/はじめる/サービス紹介",
  component: LandingPage,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <div onClickCapture={event => {
    const link = (event.target as HTMLElement).closest("a");
    if (link && !link.getAttribute("href")?.startsWith("#")) event.preventDefault();
  }}><Story /></div>],
} satisfies Meta<typeof LandingPage>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Overview: Story = { name: "サービス紹介" };
