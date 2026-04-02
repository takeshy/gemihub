import type { Route } from "./+types/hubwork.internal.api-js";

const SCRIPT = `window.gemihub = {
  async get(path, params) {
    const url = new URL('/__gemihub/api/' + path, location.origin);
    if (params) for (const [k, v] of Object.entries(params))
      url.searchParams.set(k, String(v));
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
      const err = new Error(res.statusText);
      err.status = res.status;
      err.response = await res.json().catch(() => null);
      throw err;
    }
    return res.json();
  },

  async post(path, body) {
    const res = await fetch('/__gemihub/api/' + path, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = new Error(res.statusText);
      err.status = res.status;
      err.response = await res.json().catch(() => null);
      throw err;
    }
    return res.json();
  },

  auth: {
    async me(type) {
      const res = await fetch(
        '/__gemihub/auth/me?type=' + encodeURIComponent(type),
        { credentials: 'include' }
      );
      if (res.status === 401) return null;
      if (!res.ok) throw new Error(res.statusText);
      return res.json();
    },

    async login(type, email, redirect) {
      const res = await fetch('/__gemihub/auth/login', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, email, redirect: redirect || window.location.pathname + window.location.search }),
      });
      if (!res.ok) {
        const err = new Error(res.statusText);
        err.status = res.status;
        err.response = await res.json().catch(() => null);
        throw err;
      }
      return res.json();
    },

    async logout(type) {
      const res = await fetch('/__gemihub/auth/logout', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      if (!res.ok) {
        const err = new Error(res.statusText);
        err.status = res.status;
        throw err;
      }
      return res.json();
    },

    async require(type, loginPath) {
      const user = await this.me(type);
      if (!user) {
        window.location.href =
          (loginPath || '/login') +
          '?redirect=' + encodeURIComponent(window.location.pathname + window.location.search);
        return new Promise(() => {});
      }
      return user;
    },
  },
};`;

export function loader(_args: Route.LoaderArgs) {
  return new Response(SCRIPT, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
