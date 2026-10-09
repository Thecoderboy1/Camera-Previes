# Luma Monitor

Luma Monitor turns your Android phone into a high-performance wireless camera monitor for your Mac over WebRTC with real-time video streaming, front/rear camera switching, and low latency.

---

## 1. What Caused the Earlier Errors?

When you saw these browser errors:
```text
POST /api/sessions 404 (Not Found)
Failed to create session on server
WebSocket connection to wss://lumamoniter.netlify.app/ws failed
```

### Root Cause
- **Netlify & Vercel are static frontend CDN hosts**: They host compiled HTML/JS/CSS assets (`dist/`), but **do not run persistent Python FastAPI or Node.js servers**.
- When the frontend ran on `lumamoniter.netlify.app`, requests to `/api/sessions` and `/ws` were routed to Netlify's static CDN edge rather than a backend server, producing `404 Not Found`.

---

## 2. Supported Architecture & Deployment Options

Luma Monitor supports two robust deployment architectures:

### Option A: Cloud WebRTC Mode (Zero Backend Required — Recommended for Netlify / Vercel)
- **Status**: Enabled automatically when deployed to Netlify or Vercel if no custom backend URL is configured.
- **How it works**: Uses PeerJS cloud signaling and public Google STUN servers.
- **Benefits**:
  - No Python server required.
  - No terminal commands, tunnels, or port forwarding.
  - Deploy the frontend to Netlify or Vercel and it works immediately across any Wi-Fi or internet connection!

---

### Option B: Dedicated Python FastAPI Backend (Preferred Production Architecture)
Deploy the Python backend to a persistent host (Render, Railway, Fly.io, or your local Mac), and point your Netlify / Vercel frontend to it.

#### Step 1: Deploy the Python Backend
Choose one of the following:

**Deploy to Render (Free & Fast):**
1. Push your repository to GitHub.
2. Log into [Render.com](https://render.com) and click **New > Web Service**.
3. Select your repository.
4. Set:
   - **Root Directory**: `backend`
   - **Runtime**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Under **Environment Variables**, add:
   - `ALLOWED_ORIGINS`: `https://lumamoniter.netlify.app,https://lumamonitor.vercel.app`
6. Click **Create Web Service**. Note your backend URL (e.g., `https://luma-backend-xyz.onrender.com`).

**Or Deploy to Railway:**
1. Click **New Project > Deploy from GitHub repo**.
2. Set root directory to `backend`. Railway will automatically detect `Procfile` or `Dockerfile`.
3. Generate a domain (e.g. `https://luma-backend-production.up.railway.app`).

**Or Run Locally on Your Mac:**
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python main.py
# Server listening on http://0.0.0.0:8000
```

#### Step 2: Configure the Frontend on Netlify or Vercel
In your Netlify or Vercel project dashboard:
1. Go to **Site Settings > Environment Variables** (or **Project Settings > Environment Variables** on Vercel).
2. Add:
   ```env
   VITE_BACKEND_URL=https://your-luma-backend.onrender.com
   ```
   *(Optional)*:
   ```env
   VITE_WS_URL=wss://your-luma-backend.onrender.com/ws
   ```
3. Trigger a redeploy. Your frontend will now route session creation and persistent WebSocket signaling through your dedicated FastAPI backend!

*(Note: You can also change the backend URL on the fly in the web UI by clicking the **Settings** gear icon in the top right).*

---

## 3. Running Locally on macOS

### 1. Requirements
- macOS Sonoma, Ventura, or Monterey
- Python 3.9+ (`python3 --version`)
- Node.js 18+ (`node -v`)
- Android phone on the same Wi-Fi

### 2. Find Your Mac's Wi-Fi IP
```bash
ipconfig getifaddr en0
```
Note this down (e.g., `192.168.1.50`).

### 3. macOS Firewall Settings
1. Open **System Settings > Network > Firewall**.
2. Click **Options...**.
3. Ensure **"Automatically allow built-in software to receive incoming connections"** is checked.
4. When prompted by macOS to allow `Python` or `Node` network access, click **Allow**.

### 4. Run the Python Backend
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python main.py
```
Verify health:
```bash
curl http://localhost:8000/health
# {"status":"ok","service":"luma-monitor-backend",...}
```

### 5. Run the Frontend with HTTPS Context for Android
> **Critical Mobile Security Rule**: Android Chrome and mobile browsers **require an HTTPS secure context** for camera access (`navigator.mediaDevices.getUserMedia`). Plain `http://192.168.x.x` addresses will block the camera permission prompt.

**Option 1: Using a secure tunnel (Easiest)**
```bash
npm install
npm run dev
```
In another terminal:
```bash
npx localtunnel --port 3000
```
Open the generated `https://...loca.lt` URL in your Mac browser.

---

## 4. Production Build & Deployment Files

The repository includes pre-configured deployment manifests:
- `vercel.json`: Handles SPA rewrites (`/* -> /index.html`) on Vercel.
- `netlify.toml` and `public/_redirects`: Handles SPA routing on Netlify.
- `backend/Dockerfile`: Production container build for Docker, Cloud Run, Fly.io, or Railway.
- `backend/Procfile`: Standard PaaS start command.
- `backend/render.yaml`: 1-click Render blueprint.

---

## 5. Summary Checklist for Deployed App

- [x] Fixed `POST /api/sessions 404` by detecting static CDN hosting and adding `VITE_BACKEND_URL` support.
- [x] Fixed `wss://.../ws` failures by supporting dedicated WebSocket URLs and Cloud WebRTC fallback.
- [x] Added `vercel.json` and `public/_redirects` to prevent 404s on URL reloads and QR code parameter scans.
- [x] Configured Python FastAPI backend with CORS, keepalive ping/pong, session expiration, and Dockerfile.
- [x] Verified full WebRTC peer connection lifecycle with STUN, inbound RTP metrics, and front/rear camera track replacement.
