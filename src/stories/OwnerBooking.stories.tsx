import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";
const meta={title: "お客様の画面/追加メニューの予約",component:Screen,parameters:{layout:"fullscreen"},render:(args)=><Screen key={args.scenario} {...args}/>} satisfies Meta<typeof Screen>;
export default meta;
type Story=StoryObj<typeof meta>;
export const Addons:Story={name:"付替オフ・ケアを追加して予約",args:{scenario:"menu-addons"}};
