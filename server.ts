import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const app = express();
const server = createServer(app);

// Keep track of active sessions
interface Session {
  id: string;
  viewer?: WebSocket;
  camera?: WebSocket;
  createdAt: number;
}
const sessions = new Map<string, Session>();

// Initialize WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  let currentSessionId: string | null = null;
  let currentRole: 'viewer' | 'camera' | null = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());

      if (data.type === 'create_session') {
        const sessionId = crypto.randomBytes(3).toString('hex').toUpperCase(); // 6 chars
        sessions.set(sessionId, {
          id: sessionId,
          viewer: ws,
          createdAt: Date.now()
        });
        currentSessionId = sessionId;
        currentRole = 'viewer';
        ws.send(JSON.stringify({ type: 'session_created', sessionId }));
        console.log(`Session ${sessionId} created by viewer.`);
      }

      else if (data.type === 'join_session') {
        const { sessionId, role } = data;
        const session = sessions.get(sessionId);

        if (!session) {
          ws.send(JSON.stringify({ type: 'error', message: 'Session not found' }));
          return;
        }

        if (role === 'camera') {
          if (session.camera && session.camera.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'error', message: 'Camera already connected to this session' }));
            return;
          }
          session.camera = ws;
          currentSessionId = sessionId;
          currentRole = 'camera';
          ws.send(JSON.stringify({ type: 'joined', sessionId }));
          if (session.viewer && session.viewer.readyState === WebSocket.OPEN) {
            session.viewer.send(JSON.stringify({ type: 'camera_joined' }));
          }
          console.log(`Camera joined session ${sessionId}.`);
        }
      }

      else if (data.type === 'signal') {
        const session = sessions.get(currentSessionId!);
        if (!session) return;

        // Relay to the other peer
        const target = currentRole === 'viewer' ? session.camera : session.viewer;
        if (target && target.readyState === WebSocket.OPEN) {
          target.send(JSON.stringify({
            type: 'signal',
            payload: data.payload
          }));
        }
      }

      else if (data.type === 'end_session') {
        if (currentSessionId && currentRole === 'viewer') {
          const session = sessions.get(currentSessionId);
          if (session && session.camera && session.camera.readyState === WebSocket.OPEN) {
            session.camera.send(JSON.stringify({ type: 'session_ended' }));
          }
          sessions.delete(currentSessionId);
          console.log(`Session ${currentSessionId} ended by viewer.`);
        }
      }
    } catch (err) {
      console.error('WS message error:', err);
    }
  });

  ws.on('close', () => {
    if (currentSessionId) {
      const session = sessions.get(currentSessionId);
      if (session) {
        if (currentRole === 'camera') {
          session.camera = undefined;
          if (session.viewer && session.viewer.readyState === WebSocket.OPEN) {
            session.viewer.send(JSON.stringify({ type: 'camera_left' }));
          }
          console.log(`Camera left session ${currentSessionId}.`);
        } else if (currentRole === 'viewer') {
          // If viewer leaves, kill the session and notify camera
          if (session.camera && session.camera.readyState === WebSocket.OPEN) {
            session.camera.send(JSON.stringify({ type: 'viewer_left' }));
          }
          sessions.delete(currentSessionId);
          console.log(`Viewer left session ${currentSessionId}, session deleted.`);
        }
      }
    }
  });
});

// Periodic cleanup of old idle sessions (older than 1 hour)
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now - session.createdAt > 3600000 && !session.viewer && !session.camera) {
      sessions.delete(id);
    }
  }
}, 600000);

async function startServer() {
  if (IS_PRODUCTION) {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist/index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

startServer().catch(console.error);
