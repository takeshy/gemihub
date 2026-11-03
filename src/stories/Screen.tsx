import { tr } from "../../shared/i18n";
import React, { useMemo, useState } from "react";
import { App } from "../App";
import { ApiProvider } from "../api";
import { createMockClient, scenarioProps, type Scenario } from "./mock";
export function Screen({ scenario }: { scenario: Scenario }) {
  const client = useMemo(() => createMockClient(scenario), [scenario]);
  const [notice, setNotice] = useState("");
  const [route, setRoute] = useState<{ path: string; search: string; version: number }>();
  const navigate = (href: string) => {
    const url = new URL(href, location.origin);
    setRoute(current => ({ path: url.pathname, search: url.search, version: (current?.version || 0) + 1 }));
    setNotice("");
  };
  return (
    <div
      onClickCapture={(event) => {
        const link = (event.target as HTMLElement).closest("a");
        if (link?.hasAttribute("download") && /\/export\?/.test(link.getAttribute("href") || "")) {
          event.preventDefault();
          void client<{ content: string; mimeType: string; filename: string }>(link.getAttribute("href")!).then(file => {
            const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }));
            const download = document.createElement("a"); download.href = url; download.download = file.filename;
            document.body.appendChild(download); download.click(); download.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
          }).catch(error => setNotice(error instanceof Error ? error.message : String(error)));
          return;
        }
        if(link?.hasAttribute("data-article-link")&&link.closest(".preview-surface,.local-preview-screen"))return;
        if (
          link &&
          ["/", "/manual"].includes(link.getAttribute("href") || "")
        ) {
          event.preventDefault();
          navigate(link.getAttribute("href")!);
          return;
        }
        if (link?.hasAttribute("data-publication-preview-link") || link?.hasAttribute("data-shop-request-link") || link?.hasAttribute("data-customer-inquiry-link") || link?.hasAttribute("data-staff-login-link") || link?.hasAttribute("data-article-link")) {
          event.preventDefault();
          navigate(link.getAttribute("href")!);
          return;
        }
        if (link?.hasAttribute("data-customer-images-link")) return;
        if (link && !link.getAttribute("href")?.startsWith("#")) {
          event.preventDefault();
          setNotice(
            tr("Storybook では外部画面への移動を省略します。左の一覧から確認する画面を選んでください。"),
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
          key={`${scenario}-${route?.path || ""}-${route?.search || ""}-${route?.version || 0}`}
          {...scenarioProps(scenario)}
          {...route}
          navigate={navigate}
        />
      </ApiProvider>
    </div>
  );
}
