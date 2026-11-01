import { addons } from "storybook/manager-api";
import { translate } from "../shared/i18n";
// Keep stable Japanese story IDs and index metadata while making the explorer readable in English.
addons.setConfig({
  sidebar: {
    renderLabel: ({ name }) => {
      const english = translate("en", name);
      return english === name ? name : `${english} / ${name}`;
    },
  },
});
