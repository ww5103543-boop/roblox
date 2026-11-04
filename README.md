# Insomniac (Web Client) — Railway Deployment

This folder is configured specifically for deploying **Insomniac** directly to [Railway](https://railway.app/).

---

## What's Included

- `server.py`: Production-ready cloud server with:
  - Dynamic `0.0.0.0:$PORT` binding (auto-detected from Railway's `$PORT`).
  - Full-duplex WebSocket-to-UDP relay (`/__udp`) for Roblox RakNet game traffic.
  - Multi-user session isolation (`insomniac_sid`) so different visitors can log into their own Roblox accounts without clobbering each other.
  - Automatic `X-CSRF-TOKEN` negotiation for authenticated Roblox web API calls (`/api/rbx/*`).
  - Required COOP / COEP / CORP headers for WebAssembly multithreading and `SharedArrayBuffer`.
- `Dockerfile`: Minimal Python 3.11 container image.
- `railway.json` & `Procfile`: Ready-to-go deployment configuration.
- `public/`: All static assets, engine wasm/js, stylesheets, and fonts.

---

## How to Deploy to Railway

### Option 1: Via GitHub (Recommended)

1. Initialize a git repository inside this folder or push it to a new GitHub repository:
   ```bash
   cd RobloxWeb/railwayinsominac
   git init
   git add .
   git commit -m "Deploy Insomniac to Railway"
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git branch -M main
   git push -u origin main
   ```
2. Go to [railway.app](https://railway.app/) and click **New Project** → **Deploy from GitHub repo**.
3. Select your repository. Railway will detect the `Dockerfile` / `railway.json` and deploy automatically.
4. Under your service's **Settings** → **Networking**, click **Generate Domain** (e.g. `insomniac-production.up.railway.app`).

---

### Option 2: Via Railway CLI

1. Install the Railway CLI:
   ```bash
   npm i -g @railway/cli
   ```
2. Login and deploy directly from this folder:
   ```bash
   cd RobloxWeb/railwayinsominac
   railway login
   railway init
   railway up
   ```
3. Generate a public domain:
   ```bash
   railway domain
   ```

---

## Environment Variables (Optional)

In Railway's dashboard under **Variables**, you can optionally configure:

| Variable | Description |
|---|---|
| `ROBLOSECURITY` | (Optional) A default `.ROBLOSECURITY` cookie. If set, any visitor who opens the site will automatically be logged in to this account without needing to paste a cookie. Visitors can still paste their own cookie to use a personal account. |
| `PORT` | Set automatically by Railway (default: `8770`). |

