/**
 * Vertex AI client factory.
 *
 * Organizations may select a Vertex AI project/location and connect an OAuth
 * credential. Application Default Credentials remain as a compatibility
 * fallback for organizations that have not connected an account.
 */

import { GoogleGenAI } from "@google/genai";
import { google } from "googleapis";
import type { TenantInfo } from "~/types/enterprise";
import { getOrganizationVertexGoogleAuthOptions } from "./vertex-oauth.server";
import { VERTEX_MODELS, type VertexModelKey } from "./ai/models";

export { VERTEX_MODELS, type VertexModelKey };


const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID ?? "";

/**
 * Build a Vertex-mode `GoogleGenAI` client using the organization's OAuth
 * credential when configured. The `tenant` argument provides organization-
 * specific overrides with environment fallbacks.
 */
export async function createVertexClient(tenant: TenantInfo): Promise<GoogleGenAI> {
  const googleAuthOptions = await getOrganizationVertexGoogleAuthOptions(tenant.vertexOAuthOrgId);
  return new GoogleGenAI({
    vertexai: true,
    project: tenant.vertexProjectId?.trim() || GCP_PROJECT_ID,
    location: tenant.vertexLocation?.trim() || tenant.region,
    ...(googleAuthOptions ? { googleAuthOptions } : {}),
  });
}

export async function getVertexAccessToken(tenant: TenantInfo): Promise<string> {
  const oauth = await getOrganizationVertexGoogleAuthOptions(tenant.vertexOAuthOrgId);
  const auth = new google.auth.GoogleAuth(oauth ?? { scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  const value = typeof token === "string" ? token : token?.token;
  if (!value) throw new Error("Failed to obtain Vertex AI access token");
  return value;
}
