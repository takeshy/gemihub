/**
 * /invite/:token — landing page for an org invite.
 *
 * Loader:
 *   - Looks up the invite. 404 if missing, 410 if expired/revoked/accepted.
 *   - The unguessable, single-use email link proves control of the invited
 *     mailbox before any Google login happens.
 *
 * Action (POST):
 *   - Adds the invited address as an org member, marks the invite accepted,
 *     stores the org/project selection on the session, and sends the member
 *     through Google login (the app's Drive-backed IDE needs Google OAuth).
 *     Tokenless email sessions return with the OIDC/email-login slice once
 *     the GCS project mount can serve a session without Drive tokens.
 */

import { Form, Link, redirect, useLoaderData } from "react-router";
import { Building2, CheckCircle2, Mail, ShieldCheck } from "lucide-react";
import type { Route } from "./+types/invite.$token";
import {
  addOrgMember,
  emailToUid,
  getOrganization,
} from "~/services/organizations.server";
import {
  findInviteByToken,
  isInviteAcceptable,
  markInviteAccepted,
} from "~/services/invites.server";
import { getProject } from "~/services/projects.server";
import { getTokens, setCurrentSelection } from "~/services/session.server";
import { resolveLanguage } from "~/i18n/resolve-language";

const STRINGS = {
  en: {
    tagline: "Your team's shared workspace",
    expiredTitle: "This invitation link has expired",
    expiredBody: "Ask the administrator who invited you to send a new invitation email.",
    acceptedTitle: "You have already joined",
    acceptedBody: "This invitation link has already been used.",
    openApp: "Open GemiHub",
    invitedTitle: "You're invited to {org}",
    invitedBody: " invited you to the team's shared workspace.",
    roleAdmin: "Admin",
    roleMember: "Member",
    note: "This link verifies your email address. After joining, sign in with the Google account for the same address. Expires: ",
    joinButton: "Join the team and open GemiHub",
  },
  ja: {
    tagline: "チームの共有ワークスペース",
    expiredTitle: "招待リンクの有効期限が切れています",
    expiredBody: "招待した管理者へ、新しい招待メールの送信を依頼してください。",
    acceptedTitle: "参加手続きは完了しています",
    acceptedBody: "この招待リンクはすでに使用されています。",
    openApp: "GemiHubを開く",
    invitedTitle: "{org}へ招待されています",
    invitedBody: "さんから、チームの共有ワークスペースへの招待が届きました。",
    roleAdmin: "管理者",
    roleMember: "メンバー",
    note: "このメール内の専用リンクでメールアドレスを確認しています。参加後、同じメールアドレスのGoogleアカウントでログインしてください。有効期限：",
    joinButton: "チームに参加してGemiHubを開く",
  },
} as const;

interface LoaderData {
  lang: keyof typeof STRINGS;
  state: "ok" | "expired" | "already-accepted";
  invite?: {
    orgId: string;
    orgName: string;
    email: string;
    role: string;
    expiresAt: number;
    invitedByEmail: string;
  };
}

export async function loader({ request, params }: Route.LoaderArgs): Promise<LoaderData> {
  const lang = resolveLanguage(null, request.headers.get("Accept-Language")) as keyof typeof STRINGS;
  const token = params.token;
  if (!token) throw new Response("missing token", { status: 400 });

  const invite = await findInviteByToken(token);
  if (!invite) throw new Response("invite not found", { status: 404 });

  if (invite.status === "accepted") return { lang, state: "already-accepted" };
  if (!isInviteAcceptable(invite)) return { lang, state: "expired" };

  const org = await getOrganization(invite.orgId);
  return {
    lang,
    state: "ok",
    invite: {
      orgId: invite.orgId,
      orgName: org?.name ?? invite.orgId,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt,
      invitedByEmail: invite.invitedByEmail,
    },
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const token = params.token;
  if (!token) throw new Response("missing token", { status: 400 });

  const invite = await findInviteByToken(token);
  if (!invite) throw new Response("invite not found", { status: 404 });
  if (!isInviteAcceptable(invite)) {
    throw new Response("invite no longer acceptable", { status: 410 });
  }

  const uid = emailToUid(invite.email);
  await addOrgMember({
    orgId: invite.orgId,
    uid,
    email: invite.email,
    role: invite.role,
  });
  await markInviteAccepted({
    orgId: invite.orgId,
    token,
    acceptedByUid: uid,
  });
  const defaultProject = await getProject(invite.orgId, "default");

  // Store the org selection on the session cookie so it survives the OAuth
  // round-trip, then send the member to (or past) Google login. The IDE is
  // Drive-backed by default, so every session needs Google OAuth tokens.
  const existing = await getTokens(request);
  const setCookie = await setCurrentSelection(request, {
    orgId: invite.orgId,
    projectId: defaultProject?.id ?? null,
  });
  const alreadySignedIn = !!existing?.accessToken;
  return redirect(alreadySignedIn ? "/" : "/auth/google", {
    headers: { "Set-Cookie": setCookie },
  });
}

export default function InviteLanding() {
  const data = useLoaderData() as LoaderData;
  const s = STRINGS[data.lang] ?? STRINGS.en;

  const shell = (content: React.ReactNode) => (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 via-white to-violet-50 px-5 py-10 dark:from-gray-950 dark:via-gray-900 dark:to-blue-950">
      <section className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-7 shadow-xl shadow-blue-950/5 dark:border-gray-700 dark:bg-gray-900 sm:p-9">
        <div className="mb-6 flex items-center gap-3"><img src="/icons/icon-192x192.png" alt="" className="h-10 w-10 rounded-xl" /><div><p className="font-bold text-gray-900 dark:text-white">GemiHub</p><p className="text-xs text-gray-500">{s.tagline}</p></div></div>
        {content}
      </section>
    </main>
  );

  if (data.state === "expired") {
    return shell(<><h1 className="text-xl font-bold text-gray-900 dark:text-white">{s.expiredTitle}</h1><p className="mt-3 leading-7 text-gray-600 dark:text-gray-300">{s.expiredBody}</p></>);
  }
  if (data.state === "already-accepted") {
    return shell(<><CheckCircle2 className="mb-4 text-emerald-500" size={36} /><h1 className="text-xl font-bold text-gray-900 dark:text-white">{s.acceptedTitle}</h1><p className="mt-3 text-gray-600 dark:text-gray-300">{s.acceptedBody}</p><Link to="/" className="mt-6 inline-flex rounded-lg bg-blue-600 px-5 py-2.5 font-medium text-white hover:bg-blue-700">{s.openApp}</Link></>);
  }

  const inv = data.invite!;
  return shell(<>
    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"><Mail size={24} /></div>
    <h1 className="mt-5 text-2xl font-bold text-gray-900 dark:text-white">{s.invitedTitle.replace("{org}", inv.orgName)}</h1>
    <p className="mt-3 leading-7 text-gray-600 dark:text-gray-300"><span className="font-medium text-gray-800 dark:text-gray-100">{inv.invitedByEmail}</span>{s.invitedBody}</p>
    <div className="mt-5 space-y-3 rounded-xl bg-gray-50 p-4 text-sm dark:bg-gray-800/60"><div className="flex items-center gap-3"><Building2 size={18} className="text-gray-400" /><span>{inv.orgName}</span></div><div className="flex items-center gap-3"><Mail size={18} className="text-gray-400" /><span>{inv.email}</span></div><div className="flex items-center gap-3"><ShieldCheck size={18} className="text-gray-400" /><span>{inv.role === "admin" ? s.roleAdmin : s.roleMember}</span></div></div>
    <p className="mt-4 text-xs leading-5 text-gray-500">{s.note}{new Date(inv.expiresAt).toLocaleString(data.lang === "ja" ? "ja-JP" : "en-US")}</p>
    <Form method="POST"><button type="submit" className="mt-6 w-full rounded-lg bg-blue-600 px-5 py-3 font-semibold text-white shadow-sm hover:bg-blue-700">{s.joinButton}</button></Form>
  </>);
}
