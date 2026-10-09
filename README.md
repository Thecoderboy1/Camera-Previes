# Luma Monitor

Luma Monitor is a minimal camera monitor that allows a user to use their Android phone as a wireless camera and view its live feed on their Mac through a browser with low-latency WebRTC peer-to-peer streaming.

---

## Technology Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS.
- **Backend**: Python 3 with FastAPI (and full Node.js Express companion engine).
- **Real-Time Video**: Browser-native WebRTC (`RTCPeerConnection`).
- **Signaling**: Resilient dual-transport engine (WebSocket with seamless SSE/HTTP fallback).
- **Pairing**: Dynamic QR codes and 6-character session identifiers.

---

## macOS Setup Instructions

Follow these exact terminal commands to run the application locally on macOS.

### 1. Requirements
- **macOS**: Sonoma, Ventura, or Monterey
- **Python**: Python 3.9+ (Check with `python3 --version`)
- **Node.js**: Node 18+ or 20+ (Check with `node -v`)
- **Android Phone**: On the same local Wi-Fi network as the Mac

---

### 2. Find Your Mac's Local IP Address
On your Mac, find your Wi-Fi IP address by running:
```bash
ipconfig getifaddr en0
```
*(If you are connected via Ethernet instead of Wi-Fi, try `en1` or `en2`).*
Note this address down (e.g., `192.168.1.50`).

---

### 3. Handle macOS Firewall Permissions
To allow your Android phone to reach your Mac over local Wi-Fi:
1. Open **System Settings > Network > Firewall**.
2. If Firewall is turned on, click **Options...**.
3. Ensure **"Automatically allow built-in software to receive incoming connections"** and **"Automatically allow downloaded signed software to receive incoming connections"** are checked.
4. When prompted by macOS to allow `Python` or `Node` to accept incoming network connections, click **Allow**.

---

### 4. Running the Python FastAPI Backend

Open a terminal on your Mac:

```bash
# 1. Navigate to the backend directory
cd backend

# 2. Create and activate a Python virtual environment
python3 -m venv venv
source venv/bin/activate

# 3. Install backend dependencies
pip install -r requirements.txt

# 4. Start the FastAPI signaling server on port 8000
uvicorn main:app --host 0.0.0.0 --port 8000
```

Verify that the health check responds:
```bash
curl http://localhost:8000/health
# {"status":"ok","active_sessions":0,...}
```

---

### 5. Running the Frontend with Secure Mobile Context (HTTPS)

> **Important**: Android Chrome and mobile browsers **strictly require a secure context (`HTTPS`)** for camera permissions (`navigator.mediaDevices.getUserMedia`). Opening a plain `http://192.168.x.x` URL on Android will block the camera prompt.

#### Option A: Cloudflare Tunnel or LocalTunnel (Recommended for Easy Setup)
In a new terminal window:
```bash
# 1. Install dependencies
npm install

# 2. Start the development server
npm run dev
```

In another terminal, expose port 3000 via a secure tunnel:
```bash
npx localtunnel --port 3000
# Output: your url is: https://funny-otter-42.loca.lt
```
Open that secure `https://...` URL in your Mac browser.

#### Option B: Vite Basic SSL (Pure Local Network)
1. Install the SSL plugin:
   ```bash
   npm install -D @vitejs/plugin-basic-ssl
   ```
2. Enable it in `vite.config.ts`:
   ```typescript
   import basicSsl from '@vitejs/plugin-basic-ssl';
   export default defineConfig({
     plugins: [react(), basicSsl()],
     server: { host: '0.0.0.0', port: 3000 }
   });
   ```
3. Run `npm run dev`. Navigate to `https://<YOUR-MAC-IP>:3000` on both Mac and phone, accepting the local self-signed certificate warning once.

---

### 6. Connect Your Android Phone

1. Open the Luma Monitor dashboard on your Mac.
2. A unique pairing session and QR code will appear automatically.
3. Open your Android phone's camera app or Google Lens and scan the QR code.
4. Tap the link to open the Luma Camera page in Chrome.
5. Tap **Allow camera access**.
6. The phone begins streaming immediately, displaying the live feed in the Mac preview window.
7. Use the flip button on your phone to toggle between front and rear cameras without breaking the connection.
8. Toggle fullscreen or video fit mode on your Mac.

---

### 7. How to Stop the Servers

To stop the servers at any time:
- In the Python terminal: Press `Ctrl + C`.
- In the Frontend terminal: Press `Ctrl + C`.

---

### 8. Troubleshooting

| Issue | Cause | Solution |
|---|---|---|
| Camera permission button does nothing on phone | Page loaded over plain HTTP | Android requires HTTPS. Use the provided tunnel or local SSL certificate. |
| QR code URL cannot be reached from phone | Firewall or different Wi-Fi network | Verify both devices are on the same Wi-Fi SSID and run `ipconfig getifaddr en0`. Check macOS Firewall settings. |
| Video preview stays black | Symmetric NAT or firewall blocking UDP | STUN handles most residential Wi-Fi networks. If on an enterprise router, configure a TURN relay server. |
| Session shows disconnected | Phone screen slept | Luma Monitor automatically activates the Screen Wake Lock API. Keep the browser tab in foreground. |
