# Wikichat

Wikichat is a Next.js chat frontend with an Express, Socket.IO, and MongoDB backend.

## Run locally

1. Install frontend dependencies in the repository root with `npm install`.
2. Install backend dependencies with `npm install --prefix backend`.
3. Copy `backend/.env.example` to `backend/.env`, set `MONGODB_URI`, `GOOGLE_CLIENT_ID`, and SMTP credentials, and keep the file private.
4. Copy `.env.example` to `.env.local`.
5. In one terminal, run `npm start --prefix backend`.
6. In another terminal, run `npm run dev`.

The frontend uses `NEXT_PUBLIC_API_URL` (default `http://localhost:5000`) for HTTP and Socket.IO requests, and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` to show Google sign-in. The backend uses `FRONTEND_URL` to allow the frontend origin, `MONGODB_URI` for MongoDB, `GOOGLE_CLIENT_ID` to verify Google ID tokens, and `SMTP_*` settings for email verification and password resets.

## Deploy

This repository is configured for a Render backend (`render.yaml`) and a Vercel frontend:

1. In Google Cloud Console, configure the OAuth consent screen and create a Web OAuth client. Add `http://localhost:3000` and the deployed Vercel origin as authorized JavaScript origins.
2. Create a Render web service from this repository using the included Blueprint. Set `MONGODB_URI`, `GOOGLE_CLIENT_ID`, `FRONTEND_URL`, and the `SMTP_*` values in Render's environment settings. The health check is `/healthz`.
3. Deploy the repository to Vercel with the repository root as the project root. Set `NEXT_PUBLIC_API_URL` to the public Render service URL and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` to the Web OAuth client ID, then deploy.
4. Update the Render `FRONTEND_URL` with the deployed Vercel origin and redeploy the backend.
5. In MongoDB Atlas, allow network access from the backend host. Restrict access to the provider's outbound addresses where available.

The included Render service uses the free plan, which may sleep when idle and have cold-start delays. Choose a paid plan in Render if the app needs uninterrupted availability. Never commit `.env`, `.env.local`, database credentials, SMTP passwords, or deployment secrets.

## Features

- Email verification and password reset
- Sign in with email/password or Google
- Persistent users, messages, sessions, and one-time auth tokens in MongoDB
- Real-time chat, delivery/read receipts, reactions, replies, edits, forwarding, and conversation deletion
- Profile settings, avatars, themes, and Arabic/English UI

Presence and active Socket.IO connections are runtime state and reset when the backend restarts.
