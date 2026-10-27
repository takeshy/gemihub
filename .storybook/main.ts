import type { StorybookConfig } from "@storybook/react-vite";
const config: StorybookConfig = {
  stories: ["../src/**/*.stories.tsx"],
  framework: "@storybook/react-vite",
  staticDirs: ["../public"],
  core: { disableTelemetry: true },
  typescript: { reactDocgen: false },
  viteFinal(config) {
    // Storybook runs without the application server. Never proxy to a live API.
    config.server = { ...config.server, proxy: {} };
    return config;
  },
};
export default config;
