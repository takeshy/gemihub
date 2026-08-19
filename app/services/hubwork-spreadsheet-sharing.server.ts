import { google } from "googleapis";
import type { ProjectAccessContext, ProjectRole } from "~/types/enterprise";
import { getValidTokens } from "./google-auth.server";
import { getTokens } from "./session.server";
import { getSettingsForTenant } from "./user-settings-tenant.server";

function driveRoleForProjectRole(role: ProjectRole): "reader" | "writer" {
  return role === "viewer" ? "reader" : "writer";
}

function isDuplicatePermissionError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: number }).code;
  const status = (err as { response?: { status?: number } }).response?.status;
  return code === 409 || status === 409;
}

async function getHubworkServiceAccountEmail(): Promise<string | null> {
  if (process.env.GOOGLE_CLIENT_EMAIL) return process.env.GOOGLE_CLIENT_EMAIL;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) return process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const credentials = await auth.getCredentials();
  return credentials.client_email || null;
}

function getDriveClient(accessToken: string) {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.drive({ version: "v3", auth: oauth2Client });
}

async function shareSpreadsheetWithEmail({
  drive,
  spreadsheetId,
  email,
  role,
}: {
  drive: ReturnType<typeof google.drive>;
  spreadsheetId: string;
  email: string;
  role: "reader" | "writer";
}): Promise<void> {
  try {
    await drive.permissions.create({
      fileId: spreadsheetId,
      sendNotificationEmail: false,
      requestBody: {
        type: "user",
        role,
        emailAddress: email,
      },
      fields: "id",
    });
  } catch (err) {
    if (!isDuplicatePermissionError(err)) throw err;
  }
}

export async function shareHubworkSpreadsheetWithServiceAccount({
  request,
  spreadsheetId,
}: {
  request: Request;
  spreadsheetId: string;
}): Promise<void> {
  const serviceAccountEmail = await getHubworkServiceAccountEmail();
  if (!serviceAccountEmail) {
    throw new Error("Hubwork service account email could not be resolved.");
  }

  const sessionTokens = await getTokens(request);
  if (!sessionTokens?.refreshToken || sessionTokens.authMethod === "oidc") {
    throw new Error("Sharing Hubwork spreadsheets requires Google sign-in with Drive permission.");
  }

  const { tokens } = await getValidTokens(request, sessionTokens);
  const drive = getDriveClient(tokens.accessToken);
  await shareSpreadsheetWithEmail({
    drive,
    spreadsheetId,
    email: serviceAccountEmail,
    role: "writer",
  });
}

export async function shareHubworkSpreadsheetsWithMember({
  request,
  ctx,
  email,
  role,
}: {
  request: Request;
  ctx: ProjectAccessContext;
  email: string;
  role: ProjectRole;
}): Promise<void> {
  const settings = await getSettingsForTenant(ctx);
  const spreadsheets = settings.hubwork?.spreadsheets ?? [];
  if (spreadsheets.length === 0) return;

  const sessionTokens = await getTokens(request);
  if (!sessionTokens?.refreshToken || sessionTokens.authMethod === "oidc") {
    throw new Error("Sharing Hubwork spreadsheets requires Google sign-in with Drive permission.");
  }

  const { tokens } = await getValidTokens(request, sessionTokens);
  const drive = getDriveClient(tokens.accessToken);
  const driveRole = driveRoleForProjectRole(role);

  for (const spreadsheet of spreadsheets) {
    await shareSpreadsheetWithEmail({
      drive,
      spreadsheetId: spreadsheet.id,
      email,
      role: driveRole,
    });
  }
}
