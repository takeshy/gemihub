/**
 * Pending org-membership invites — Phase 5e-step3.
 *
 * Stored at organizations/{orgId}/invites/{token}. Tokens are 32-byte
 * random hex; the URL is the entire credential, so they're treated like
 * passwords (length-bounded, single-use, rate-limited via the API route).
 *
 * An invite consumes itself on accept. Expired or revoked invites stay in
 * the collection (status flag) for audit.
 */

import crypto from "node:crypto";
import { FieldValue } from "@google-cloud/firestore";
import {
  getFirestore,
  ORGANIZATIONS,
} from "./firestore.server";
import type { OrgRole } from "~/types/enterprise";

const INVITES_SUBCOLLECTION = "invites";
const DEFAULT_EXPIRY_DAYS = 14;

export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";

export interface OrgInvite {
  token: string;
  orgId: string;
  email: string;
  role: OrgRole;
  invitedByUid: string;
  invitedByEmail: string;
  createdAt: number;
  expiresAt: number;
  status: InviteStatus;
  acceptedAt?: number;
  acceptedByUid?: string;
}

function inviteCol(orgId: string) {
  return getFirestore()
    .collection(ORGANIZATIONS)
    .doc(orgId)
    .collection(INVITES_SUBCOLLECTION);
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function createInvite(input: {
  orgId: string;
  email: string;
  role: OrgRole;
  invitedByUid: string;
  invitedByEmail: string;
  expiryDays?: number;
}): Promise<OrgInvite> {
  const token = generateToken();
  const now = Date.now();
  const expiresAt =
    now + (input.expiryDays ?? DEFAULT_EXPIRY_DAYS) * 24 * 60 * 60 * 1000;
  const invite: OrgInvite = {
    token,
    orgId: input.orgId,
    email: input.email.trim().toLowerCase(),
    role: input.role,
    invitedByUid: input.invitedByUid,
    invitedByEmail: input.invitedByEmail,
    createdAt: now,
    expiresAt,
    status: "pending",
  };
  await inviteCol(input.orgId).doc(token).set(invite);
  return invite;
}

/**
 * Look up an invite by token across all orgs. Tokens are global so the
 * /invite/:token landing page doesn't need the orgId in the URL.
 */
export async function findInviteByToken(token: string): Promise<OrgInvite | null> {
  const snap = await getFirestore()
    .collectionGroup(INVITES_SUBCOLLECTION)
    .where("token", "==", token)
    .limit(2)
    .get();
  if (snap.empty) return null;
  if (snap.size > 1) {
    throw new Error(`token collision detected for ${token.slice(0, 8)}…`);
  }
  return snap.docs[0].data() as OrgInvite;
}

export async function listInvitesForOrg(orgId: string): Promise<OrgInvite[]> {
  const snap = await inviteCol(orgId).orderBy("createdAt", "desc").get();
  return snap.docs.map((d) => d.data() as OrgInvite);
}

export async function markInviteAccepted(input: {
  orgId: string;
  token: string;
  acceptedByUid: string;
}): Promise<void> {
  await inviteCol(input.orgId)
    .doc(input.token)
    .update({
      status: "accepted",
      acceptedAt: Date.now(),
      acceptedByUid: input.acceptedByUid,
    });
}

export async function revokeInvite(orgId: string, token: string): Promise<void> {
  await inviteCol(orgId).doc(token).update({
    status: "revoked",
    revokedAt: FieldValue.serverTimestamp(),
  });
}

/** Convenience: is this invite still acceptable now? */
export function isInviteAcceptable(invite: OrgInvite): boolean {
  return invite.status === "pending" && invite.expiresAt > Date.now();
}
