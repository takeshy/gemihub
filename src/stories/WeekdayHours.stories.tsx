import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";
const meta={title: "運営/設定/曜日別の営業時間",component:Screen,parameters:{layout:"fullscreen"},render:(args)=><Screen key={args.scenario} {...args}/>} satisfies Meta<typeof Screen>;
export default meta;
type Story=StoryObj<typeof meta>;
export const TueFri:Story={name:"通常19時・火金21時まで",args:{scenario:"weekday-hours"}};
export const SpecialDays:Story={name:"祝日は営業・翌日休み・特定日だけ22時まで",args:{scenario:"special-days"}};
