#!/usr/bin/env node
/**
 * One-time helper: obtain the offline REFRESH TOKEN for the platform's
 * YouTube channel, for YOUTUBE_REFRESH_TOKEN in the backend .env.
 *
 * Prerequisites (Google Cloud console):
 *   1. Create a project, enable "YouTube Data API v3".
 *   2. Create an OAuth client of type "Web application" and add
 *      http://127.0.0.1:8642/callback to its authorized redirect URIs.
 *   3. The Google account you log in with must own the YouTube channel,
 *      and the channel must have live streaming enabled
 *      (verified by phone; first enablement takes 24h).
 *
 * Usage:
 *   YOUTUBE_CLIENT_ID=... YOUTUBE_CLIENT_SECRET=... node scripts/get-youtube-refresh-token.mjs
 *
 * Then open the printed URL in a browser, approve, and copy the refresh
 * token this script prints into .env.
 */
import http from 'node:http';
import crypto from 'node:crypto';

const clientId = process.env.YOUTUBE_CLIENT_ID;
const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in the environment first.');
  process.exit(1);
}

const PORT = 8642;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const state = crypto.randomBytes(16).toString('hex');

const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: 'code',
    // Full YouTube scope — the Live Streaming API needs it to create
    // broadcasts and delete the archived videos.
    scope: 'https://www.googleapis.com/auth/youtube',
    access_type: 'offline',
    prompt: 'consent', // force a refresh token even on re-approval
    state,
  }).toString();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname !== '/callback') {
    res.writeHead(404).end();
    return;
  }
  if (url.searchParams.get('state') !== state) {
    res.writeHead(400).end('State mismatch — start over.');
    return;
  }
  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400).end(`Google returned: ${url.searchParams.get('error') ?? 'no code'}`);
    return;
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT,
    }).toString(),
  });
  const data = await tokenRes.json();

  if (!tokenRes.ok || !data.refresh_token) {
    res.writeHead(500).end('Token exchange failed — see the terminal.');
    console.error('Token exchange failed:', data);
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
      .end('Done — you can close this tab. The refresh token is in the terminal.');
    console.log('\nAdd these to the backend .env:\n');
    console.log(`LIVE_PROVIDER=youtube`);
    console.log(`YOUTUBE_CLIENT_ID=${clientId}`);
    console.log(`YOUTUBE_CLIENT_SECRET=${clientSecret}`);
    console.log(`YOUTUBE_REFRESH_TOKEN=${data.refresh_token}`);
  }
  server.close();
});

server.listen(PORT, () => {
  console.log('1. Open this URL in a browser and approve access:\n');
  console.log(authUrl + '\n');
  console.log(`2. Waiting for Google to redirect to ${REDIRECT} …`);
});
