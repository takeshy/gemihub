import assert from "node:assert/strict";
import test from "node:test";
import { getAuthLoginErrorResponse } from "./hubwork.internal.auth.login.tsx";

test("getAuthLoginErrorResponse maps scope/auth failures to 403", async () => {
  const response = getAuthLoginErrorResponse(new Error("Request had insufficient authentication scopes."));

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "Hubwork Gmail/Sheets scopes are required",
  });
});

test("getAuthLoginErrorResponse maps unknown failures to 500", async () => {
  const response = getAuthLoginErrorResponse(new Error("smtp exploded"));

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Failed to send login email",
  });
});
