---
type: Architecture
title: Self-Hosting
description: "Self-hosting setup: Google Cloud project and OAuth client, the drive.file scope, Gemini API key, environment variables, dev server, and Docker/production builds."
tags:
  - self-hosting
  - setup
  - oauth
---
# Self-Hosting

GemiHub runs entirely on your own infrastructure: a Node.js server, your Google Cloud OAuth client, and your Gemini API key. No database is required — all user data lives in the user's Google Drive.

For the managed Cloud Run / Terraform deployment used by gemihub.net, see [Infrastructure](infrastructure.md).

## Prerequisites

- Node.js 24+
- A Google Cloud project (setup below)
- A Gemini API key

## 1. Google Cloud setup

Open the [Google Cloud Console](https://console.cloud.google.com/) and do the following.

### Create a project

1. Click "Select a project" at the top left → "New Project" → name it and create.

### Enable the Google Drive API

1. Go to "APIs & Services" → "Library".
2. Search for "Google Drive API" and click "Enable".

### Configure the OAuth consent screen

1. Go to "APIs & Services" → "OAuth consent screen".
2. User Type: **External**.
3. Fill in the app name (e.g. GemiHub), support email, and developer contact.
4. Add the scope `https://www.googleapis.com/auth/drive.file`.
5. Add your Gmail address as a test user — before publishing, only test users can sign in.

> **Important: what `drive.file` can see**
>
> The `drive.file` scope grants access **only to files the app itself created**. Files you upload to the `gemihub/` folder through the Google Drive web UI or another app are **invisible** to GemiHub. Add files with the in-app upload feature or create them through AI chat.

### Create OAuth credentials

1. Go to "APIs & Services" → "Credentials" → "+ Create Credentials" → "OAuth client ID".
2. Application type: **Web application**.
3. Name: anything (e.g. GemiHub Local).
4. Add an **Authorized redirect URI**: `http://localhost:8132/auth/google/callback`.
5. Copy the **Client ID** and **Client Secret**.

## 2. Get a Gemini API key

1. Go to [Google AI Studio](https://aistudio.google.com/).
2. Left menu → "API keys" → "Create API key".
3. Copy the key — you enter it later on the app's Settings page, not in `.env`.

> **Free vs. paid API:** the free Gemini API tier has strict rate limits and restricted model access — enough for a quick test, not for regular use. For the full experience you need a paid plan. [Google AI Pro](https://one.google.com/about/ai-premium) ($19.99/month) is a good option: it includes $10/month of Google Cloud credits that cover substantial Gemini API usage, plus 2 TB of Google One storage and Gemini Code Assist. See [Gemini API pricing](https://ai.google.dev/pricing).

## 3. Clone and install

```bash
git clone <repository-url>
cd gemihub
npm install
```

## 4. Configure the environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-client-secret
GOOGLE_PICKER_API_KEY=your-browser-api-key
GOOGLE_REDIRECT_URI=http://localhost:8132/auth/google/callback
SESSION_SECRET=<random string>
# Optional: managed GemiHub OKF distribution in private Cloud Storage
GEMIHUB_OKF_BUCKET=<bucket-name>
GEMIHUB_OKF_PREFIX=gemihub-okf
```

Generate `SESSION_SECRET` with:

```bash
openssl rand -hex 32
```

## 5. Start the dev server

```bash
npm run dev
```

The dev server port is `8132`, configured in `vite.config.ts`. To change it, update the config, the redirect URI in `.env`, and the authorized redirect URI in the Google Cloud Console.

## 6. First-time setup in the app

1. Open `http://localhost:8132`.
2. Click "Sign in with Google" and authorize your account.
3. Click the gear icon (Settings) in the top right.
4. In the **General** tab, enter your Gemini API key and save.

Chat, workflows, and file editing are ready.

## Production

### Build and run

```bash
npm run build
npm run start
```

`npm run start` serves the production build via `server.js` on port 8080.

### Docker

```bash
docker build -t gemihub .
docker run -p 8080:8080 \
  -e GOOGLE_CLIENT_ID=... \
  -e GOOGLE_CLIENT_SECRET=... \
  -e GOOGLE_PICKER_API_KEY=... \
  -e GOOGLE_REDIRECT_URI=https://your-domain/auth/google/callback \
  -e SESSION_SECRET=... \
  gemihub
```

Remember to add the production redirect URI to the OAuth client in the Google Cloud Console, and to publish the OAuth consent screen if users other than your test accounts will sign in.

## What self-hosting does not include

Paid-plan features of the hosted service — page hosting from `web/`, custom domains, scheduled workflows, Google Sheets and Gmail nodes, organization projects on Cloud Storage and Vertex AI — depend on Firestore, Cloud Storage, and Stripe wiring described in [Premium Plan](premium.md) and [Storage Mounts & AI Providers](mounts.md). A plain self-hosted instance runs the free feature set against the user's own Drive.
