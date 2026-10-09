# Luma Monitor

Luma Monitor is a minimal camera monitor that allows you to use your Android phone as a wireless camera and view its live feed on your Mac through a browser with low-latency WebRTC peer-to-peer streaming.

---

## Deployment & Signaling Modes

Luma Monitor supports two seamless modes:

### 1. Cloud WebRTC (Default for Netlify & Static Hosts)
- **Zero backend required**: Designed for static hosts like Netlify (`lumamoniter.netlify.app`), Vercel, or GitHub Pages.
- Both your Mac and Android phone connect directly peer-to-peer via public STUN servers and PeerJS cloud signaling.
- No terminal commands, tunnels, or port forwarding required when deployed to Netlify!

### 2. Local Python / Node Backend
- Run the FastAPI backend directly on your Mac:
  ```bash
  cd backend
  pip install -r requirements.txt
  uvicorn main:app --host 0.0.0.0 --port 8000
  ```
- If your frontend is hosted on Netlify and you want to use your local Python server, simply open **Settings** on the dashboard and enter your Mac's LAN IP (e.g., `http://192.168.1.50:8000`) or tunnel URL.

---

## macOS Setup Instructions (Running Entirely on Local Mac)

### 1. Requirements
- **macOS**: Sonoma, Ventura, or Monterey
- **Python**: Python 3.9+ (`python3 --version`)
- **Node.js**: Node 18+ or 20+ (`node -v`)
- **Android Phone**: On the same local Wi-Fi network as the Mac

---

### 2. Find Your Mac's Local IP Address
On your Mac, find your Wi-Fi IP address by running:
```bash
ipconfig getifaddr en0
```
*(If connected via Ethernet, try `en1` or `en2`).* Note this down (e.g. `192.168.1.50`).

---

### 3. Handle macOS Firewall Permissions
To allow your Android phone to reach your Mac over local Wi-Fi:
1. Open **System Settings > Network > Firewall**.
2. If Firewall is turned on, click **Options...**.
3. Ensure **"Automatically allow built-in software to receive incoming connections"** is checked.
4. When prompted by macOS to allow `Python` or `Node` to accept incoming connections, click **Allow**.

---

### 4. Running the Python Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

Verify health:
```bash
curl http://localhost:8000/health
```

---

### 5. Running the Frontend with Secure Mobile Context (HTTPS)

> **Important**: Android Chrome requires a secure context (`HTTPS`) for camera permissions (`navigator.mediaDevices.getUserMedia`).

#### Easy Tunnel Setup:
```bash
npm install
npm run dev
```
In another terminal:
```bash
npx localtunnel --port 3000
```
Open the generated `https://...loca.lt` URL on your Mac.

---

### 6. Connect Your Android Phone

1. Open the Luma Monitor dashboard on your Mac.
2. A unique pairing session and QR code will appear automatically.
3. Open your Android phone's camera app or Google Lens and scan the QR code.
4. Tap the link to open the Luma Camera page in Chrome.
5. Tap **Allow camera access**.
6. The phone begins streaming immediately, displaying the live feed in the Mac preview window.
7. Use the flip button on your phone to toggle between front and rear cameras without breaking the connection.
