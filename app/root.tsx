import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "icon", type: "image/x-icon", href: "/favicon.ico" },
  { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
  { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" },
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />
        <Meta />
        <Links />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var f=localStorage.getItem("gemihub-fontSize");var l=localStorage.getItem("gemihub-language");if(f)document.documentElement.style.fontSize=f+"px";if(l)document.documentElement.lang=l;var t=localStorage.getItem("gemihub-theme")||"system";var d=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(d){document.documentElement.classList.add("dark");document.documentElement.style.colorScheme="dark";}else{document.documentElement.style.colorScheme="light";}}catch(e){}})();`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: [
              // Register SW and warm cache on every activation (first install AND updates).
              // On the very first visit, the initial navigation request happens BEFORE the SW
              // is active, so the HTML and assets are NOT cached. On SW updates, skipWaiting +
              // clients.claim cause controllerchange to fire, so we always listen for it.
              'if("serviceWorker"in navigator){window.addEventListener("load",function(){',
              'navigator.serviceWorker.register("/sw.js").then(function(){',
              'navigator.serviceWorker.addEventListener("controllerchange",function cc(){',
              'navigator.serviceWorker.removeEventListener("controllerchange",cc);',
              'var urls=["/"];',
              'if(window.location.pathname!=="/")urls.push(window.location.pathname);',
              'document.querySelectorAll("link[href^=\\"/assets/\\"],script[src^=\\"/assets/\\"]").forEach(function(el){',
              'var u=el.href||el.src;if(u)urls.push(new URL(u).pathname);',
              '});',
              'if(navigator.serviceWorker.controller){',
              'navigator.serviceWorker.controller.postMessage({type:"warmup",urls:urls});',
              '}',
              '});',
              '}).catch(function(){});',
              '})}',
            ].join(""),
          }}
        />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
