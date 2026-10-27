import type { Preview } from "@storybook/react-vite";
import "../src/style.css";
const preview: Preview = {
  parameters: { layout: "fullscreen", controls: { disable: true } },
};
export default preview;
