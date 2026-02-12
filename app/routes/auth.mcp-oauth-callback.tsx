// OAuth callback page for MCP server authentication
// Receives authorization code from OAuth provider and relays it back
// to the settings page via window.opener.postMessage() and localStorage fallback

import { useEffect, useState } from "react";

export default function McpOAuthCallback() {
  const [status, setStatus] = useState("Processing...");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const msg = {
      type: "mcp-oauth-callback" as const,
      code: params.get("code"),
      state: params.get("state"),
      error: params.get("error"),
      errorDescription: params.get("error_description"),
    };

    // Redirect flow: no opener means we arrived via same-tab redirect (mobile)
    if (!window.opener) {
      try {
        sessionStorage.setItem("mcp-oauth-callback-result", JSON.stringify(msg));
      } catch {
        // sessionStorage unavailable
      }
      setStatus("Redirecting back to settings...");
      window.location.href = "/settings?mcp-oauth-return=1";
      return;
    }

    // Popup flow: try postMessage to opener
    try {
      window.opener.postMessage(msg, window.location.origin);
    } catch {
      // postMessage failed, fall through to localStorage
    }

    // Popup flow: write to localStorage as fallback
    try {
      localStorage.setItem("mcp-oauth-callback", JSON.stringify(msg));
      setTimeout(() => {
        localStorage.removeItem("mcp-oauth-callback");
      }, 5000);
    } catch {
      // localStorage unavailable
    }

    setStatus("Authorization complete. You can close this window.");

    setTimeout(() => {
      window.close();
    }, 2000);
  }, []);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        margin: 0,
        fontFamily: "system-ui, sans-serif",
        backgroundColor: "#f9fafb",
        color: "#374151",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <p>{status}</p>
      </div>
    </div>
  );
}
