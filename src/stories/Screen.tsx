import React, { useMemo, useState } from "react";
import { App } from "../App";
import { ApiProvider } from "../api";
import { createMockClient, scenarioProps, type Scenario } from "./mock";
export function Screen({ scenario }: { scenario: Scenario }) {
  const client = useMemo(() => createMockClient(scenario), [scenario]);
  const [notice, setNotice] = useState("");
  const [route, setRoute] = useState<{ path: string; search: string }>();
  const navigate = (href: string) => {
    const url = new URL(href, location.origin);
    setRoute({ path: url.pathname, search: url.search });
    setNotice("");
  };
  return (
    <div
      onClickCapture={(event) => {
        const link = (event.target as HTMLElement).closest("a");
        if (
          link &&
          ["/", "/manual"].includes(link.getAttribute("href") || "")
        ) {
          event.preventDefault();
          navigate(link.getAttribute("href")!);
          return;
        }
        if (link?.hasAttribute("data-article-link")) {
          event.preventDefault();
          navigate(link.getAttribute("href")!);
          return;
        }
        if (link && !link.getAttribute("href")?.startsWith("#")) {
          event.preventDefault();
          setNotice(
            "Storybook では外部画面への移動を省略します。左の一覧から確認する画面を選んでください。",
          );
        }
      }}
    >
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      <ApiProvider value={client}>
        <App
          key={`${scenario}-${route?.path || ""}-${route?.search || ""}`}
          {...scenarioProps(scenario)}
          {...route}
          navigate={navigate}
        />
      </ApiProvider>
    </div>
  );
}
