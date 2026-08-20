import type { DashboardData } from "~/dashboard/types";

export const workflowFixture = `version: 1
name: Weekly content report
description: Collect updates, summarize them, and request approval.
inputs:
  - name: topic
    type: string
    default: Product updates
nodes:
  - id: collect
    type: drive-search
    query: "{{topic}}"
    next: summarize
  - id: summarize
    type: command
    command: summarize
    prompt: Create a concise weekly report from {{collect}}
    next: review
  - id: review
    type: dialog
    title: Review weekly report
    message: "{{summarize}}"
    next: publish
  - id: publish
    type: drive-save
    fileName: Reports/weekly.md
    content: "{{summarize}}"
`;

export const dashboardFixture: DashboardData = {
  version: 1,
  grid: { cols: 12, rowHeight: 80, gap: 8 },
  widgets: [
    {
      id: "metrics",
      type: "storybook-metrics",
      layout: { lg: { x: 0, y: 0, w: 4, h: 3 } },
      config: {},
    },
    {
      id: "activity",
      type: "storybook-activity",
      layout: { lg: { x: 4, y: 0, w: 8, h: 3 } },
      config: {},
    },
    {
      id: "projects",
      type: "storybook-projects",
      layout: { lg: { x: 0, y: 3, w: 7, h: 4 } },
      config: {},
    },
    {
      id: "calendar",
      type: "calendar",
      layout: { lg: { x: 7, y: 3, w: 5, h: 4 } },
      config: {},
    },
  ],
};
