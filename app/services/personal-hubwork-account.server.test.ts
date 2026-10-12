import assert from "node:assert/strict";
import test from "node:test";
import type { HubworkAccount } from "~/types/hubwork";
import { getOwnedPersonalAccount } from "./personal-hubwork-account.server";

const member = { email: "member@example.com", rootFolderId: "member-root", currentOrgId: "org-owned-by-someone-else" };
const ownerAccount = { id: "owner", email: "owner@example.com", rootFolderId: "owner-root" } as HubworkAccount;
const memberAccount = { id: "member", email: member.email, rootFolderId: member.rootFolderId } as HubworkAccount;

test("organization member without a personal account cannot register the organization's owner", async () => {
  const account = await getOwnedPersonalAccount(member, {
    getAccountByRootFolderId: async root => { assert.equal(root, member.rootFolderId); return null; },
    getAccountByEmail: async email => { assert.equal(email, member.email); return ownerAccount; },
  });
  assert.equal(account, null);
});

test("organization selection does not replace the member's own personal account", async () => {
  const account = await getOwnedPersonalAccount(member, {
    getAccountByRootFolderId: async root => { assert.equal(root, member.rootFolderId); return memberAccount; },
    getAccountByEmail: async () => { throw new Error("Should use the personal root account"); },
  });
  assert.equal(account?.id, memberAccount.id);
});

test("matching root alone never authorizes another owner's credentials", async () => {
  assert.equal(await getOwnedPersonalAccount(member, {
    getAccountByRootFolderId: async () => ({ ...ownerAccount, rootFolderId: member.rootFolderId }),
    getAccountByEmail: async () => { throw new Error("Must reject the mismatched root owner"); },
  }), null);
});

test("email fallback can link only the signed-in owner's account", async () => {
  const oldAccount = { ...memberAccount, rootFolderId: "old-root" };
  assert.equal(await getOwnedPersonalAccount({ ...member, email: "MEMBER@example.com" }, {
    getAccountByRootFolderId: async () => null,
    getAccountByEmail: async email => { assert.equal(email, member.email); return oldAccount; },
  }), oldAccount);
});

test("missing verified email prevents any lookup or registration", async () => {
  assert.equal(await getOwnedPersonalAccount({ email: " ", rootFolderId: member.rootFolderId }, {
    getAccountByRootFolderId: async () => { throw new Error("Should not look up an unverified identity"); },
    getAccountByEmail: async () => { throw new Error("Should not look up an unverified identity"); },
  }), null);
});
