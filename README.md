# Luma Monitor

Luma Monitor is a web application that allows you to use your Android phone as a wireless camera and view its live feed on your Mac.

It uses WebRTC for real-time video streaming directly between your phone and Mac, and a WebSocket signaling server to negotiate the connection.

## macOS Setup Instructions

Follow these exact steps to run the application locally on your Mac.

### Prerequisites

- **Python 3.9+**: For running the FastAPI backend.
- **Node.js 18+**: For building the frontend.
- **Android Phone**: Must be on the same Wi-Fi network as the Mac.

### 1. Start the Python Backend

The backend handles WebRTC signaling (exchanging session IDs, offers, and ICE candidates).

1. Open your Terminal.
2. Navigate to the backend directory:
   ```bash
   cd backend
   ```
3. (Optional) Create a virtual environment:
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```
4. Install the requirements:
   ```bash
   pip install -r requirements.txt
   ```
5. Run the FastAPI server:
   ```bash
   uvicorn main:app --host 0.0.0.0 --port 8000
   ```
   *Note: `0.0.0.0` allows the server to accept connections from other devices on your local network.*

### 2. Configure the Frontend

The frontend needs to know where the backend is running.

1. Open a new Terminal tab.
2. Navigate to the project root directory.
3. Install dependencies:
   ```bash
   npm install
   ```
4. If you are running the frontend via standard Vite (without the included Express server), you may need to configure the proxy in `vite.config.ts`. However, for this project, an integrated Node.js `server.ts` is provided for the AI Studio environment, but you can also simply run:
   ```bash
   npm run dev
   ```
   This will start the local development server on port `3000`.

### 3. HTTPS and Local Network Access (Crucial)

Android browsers **require a secure context (HTTPS)** to access the camera (`getUserMedia`). If you access the frontend using a standard HTTP IP address (e.g., `http://192.168.1.5:3000`), the phone will block camera access.

**Option A: LocalTunnel / Ngrok (Easiest)**
Use a tunneling tool to expose your local port securely to the internet.
1. Install localtunnel: `npm install -g localtunnel`
2. Run the tunnel pointing to the frontend port:
   ```bash
   lt --port 3000
   ```
3. Open the provided `https://...loca.lt` URL on your Mac browser.
4. Create a session, and scan the QR code with your phone. Since the URL is HTTPS, the Android browser will allow camera access.

**Option B: Vite Basic SSL**
If you prefer to stay purely local, configure Vite to use SSL.
1. Install the plugin: `npm install @vitejs/plugin-basic-ssl -D`
2. Update `vite.config.ts`:
   ```typescript
   import basicSsl from '@vitejs/plugin-basic-ssl'
   export default defineConfig({
     plugins: [react(), basicSsl()]
   })
   ```
3. Run `npm run dev -- --host`. Access via `https://192.168.x.x:3000`. You will need to click "Advanced -> Proceed" on both devices to bypass the self-signed certificate warning.

### 4. Connect Your Android Phone

1. Once the dashboard is open on your Mac (via HTTPS tunnel or SSL), it will automatically create a session and display a QR code.
2. Open your Android phone's camera app and scan the QR code.
3. Tap the link to open it in Chrome.
4. Tap **Allow camera access**.
5. The video feed will instantly appear on your Mac.

### Troubleshooting

- **No Camera Permission Prompt on Phone**: Ensure you opened an `https://` URL on the phone, not `http://`.
- **QR Code Doesn't Load**: Check your firewall settings on Mac to ensure Node/Python can accept incoming connections.
- **Video Stays Black**: Ensure both devices are on the same Wi-Fi. Some corporate or public Wi-Fi networks block WebRTC or P2P connections; in this case, a TURN server would be required (currently uses Google's public STUN server).

### Stopping the Server

Press `Ctrl+C` in both terminal tabs to stop the Python and Node.js servers.
