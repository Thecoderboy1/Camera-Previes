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
const PORT = Number(process.env.PORT) || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

interface PendingMessage {
  id: string;
  type: string;
  payload?: any;
  timestamp: number;
}

interface SSEResponse {
  res: express.Response;
  role: 'viewer' | 'camera';
}

interface Session {
  id: string;
  token: string;
  viewerWs?: WebSocket;
  cameraWs?: WebSocket;
  sseClients: SSEResponse[];
  viewerMessages: PendingMessage[];
  cameraMessages: PendingMessage[];
  createdAt: number;
  lastActivity: number;
  expiresAt: number;
}

const sessions = new Map<string, Session>();
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour TTL
const INACTIVITY_TTL_MS = 15 * 60 * 1000; // 15 mins inactivity

const app = express();
app.use(express.json());

// Enable CORS for API requests
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

function broadcastToSession(session: Session, targetRole: 'viewer' | 'camera' | 'all', message: any) {
  const jsonStr = JSON.stringify(message);

  // Send to WebSockets
  if (targetRole === 'viewer' || targetRole === 'all') {
    if (session.viewerWs && session.viewerWs.readyState === WebSocket.OPEN) {
      session.viewerWs.send(jsonStr);
    }
  }
  if (targetRole === 'camera' || targetRole === 'all') {
    if (session.cameraWs && session.cameraWs.readyState === WebSocket.OPEN) {
      session.cameraWs.send(jsonStr);
    }
  }

  // Send to SSE clients
  for (const client of session.sseClients) {
    if (targetRole === 'all' || client.role === targetRole) {
      try {
        client.res.write(`data: ${jsonStr}\n\n`);
      } catch {
        // Ignored, cleaned up on close
      }
    }
  }

  // Store in pending queue for HTTP polling
  const pending: PendingMessage = {
    id: crypto.randomUUID(),
    type: message.type,
    payload: message.payload,
    timestamp: Date.now()
  };

  if (targetRole === 'viewer' || targetRole === 'all') {
    session.viewerMessages.push(pending);
    if (session.viewerMessages.length > 50) session.viewerMessages.shift();
  }
  if (targetRole === 'camera' || targetRole === 'all') {
    session.cameraMessages.push(pending);
    if (session.cameraMessages.length > 50) session.cameraMessages.shift();
  }
}

// REST Endpoints
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    activeSessions: sessions.size,
    timestamp: Date.now()
  });
});

app.post('/api/sessions', (req, res) => {
  const sessionId = crypto.randomBytes(3).toString('hex').toUpperCase(); // 6 hex chars
  const token = crypto.randomBytes(16).toString('hex');
  const now = Date.now();

  const session: Session = {
    id: sessionId,
    token,
    sseClients: [],
    viewerMessages: [],
    cameraMessages: [],
    createdAt: now,
    lastActivity: now,
    expiresAt: now + SESSION_TTL_MS
  };

  sessions.set(sessionId, session);

  res.status(201).json({
    sessionId,
    token,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt
  });
});

app.get('/api/sessions/:id', (req, res) => {
  const session = sessions.get(req.params.id.toUpperCase());
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }

  if (Date.now() > session.expiresAt) {
    sessions.delete(session.id);
    return res.status(410).json({ error: 'Session expired' });
  }

  session.lastActivity = Date.now();

  const hasViewer = (session.viewerWs && session.viewerWs.readyState === WebSocket.OPEN) ||
    session.sseClients.some(c => c.role === 'viewer');
  const hasCamera = (session.cameraWs && session.cameraWs.readyState === WebSocket.OPEN) ||
    session.sseClients.some(c => c.role === 'camera');

  res.json({
    sessionId: session.id,
    hasViewer,
    hasCamera,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt
  });
});

app.post('/api/sessions/:id/signal', (req, res) => {
  const session = sessions.get(req.params.id.toUpperCase());
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  session.lastActivity = Date.now();
  const { role, payload, type } = req.body;

  if (type === 'camera_joined') {
    broadcastToSession(session, 'viewer', { type: 'camera_joined' });
    return res.json({ success: true });
  }

  if (type === 'end_session') {
    broadcastToSession(session, 'camera', { type: 'session_ended' });
    sessions.delete(session.id);
    return res.json({ success: true });
  }

  const targetRole = role === 'viewer' ? 'camera' : 'viewer';
  broadcastToSession(session, targetRole, {
    type: 'signal',
    payload
  });

  res.json({ success: true });
});

// SSE Stream for reliable fallback
app.get('/api/sessions/:id/events', (req, res) => {
  const sessionId = req.params.id.toUpperCase();
  const role = (req.query.role as 'viewer' | 'camera') || 'viewer';
  const session = sessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  session.lastActivity = Date.now();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // Send initial joined acknowledgment
  res.write(`data: ${JSON.stringify({ type: 'connected', role })}\n\n`);

  if (role === 'camera') {
    broadcastToSession(session, 'viewer', { type: 'camera_joined' });
  }

  const client: SSEResponse = { res, role };
  session.sseClients.push(client);

  const heartbeat = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    session.sseClients = session.sseClients.filter(c => c !== client);
    if (role === 'camera') {
      broadcastToSession(session, 'viewer', { type: 'camera_left' });
    } else if (role === 'viewer') {
      broadcastToSession(session, 'camera', { type: 'viewer_left' });
    }
  });
});

// Message polling fallback
app.get('/api/sessions/:id/messages', (req, res) => {
  const sessionId = req.params.id.toUpperCase();
  const role = req.query.role as 'viewer' | 'camera';
  const session = sessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  session.lastActivity = Date.now();
  const queue = role === 'viewer' ? session.viewerMessages : session.cameraMessages;
  const messages = [...queue];
  queue.length = 0; // drain

  res.json({ messages });
});

// Create HTTP server
const server = createServer(app);

// WebSocket Server attached to same server
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  let currentSessionId: string | null = null;
  let currentRole: 'viewer' | 'camera' | null = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());

      if (data.type === 'create_session') {
        const sessionId = crypto.randomBytes(3).toString('hex').toUpperCase();
        const token = crypto.randomBytes(16).toString('hex');
        const now = Date.now();

        const session: Session = {
          id: sessionId,
          token,
          viewerWs: ws,
          sseClients: [],
          viewerMessages: [],
          cameraMessages: [],
          createdAt: now,
          lastActivity: now,
          expiresAt: now + SESSION_TTL_MS
        };

        sessions.set(sessionId, session);
        currentSessionId = sessionId;
        currentRole = 'viewer';

        ws.send(JSON.stringify({ type: 'session_created', sessionId, token }));
      } else if (data.type === 'join_session') {
        const { sessionId, role } = data;
        const normalizedId = String(sessionId).toUpperCase();
        const session = sessions.get(normalizedId);

        if (!session) {
          ws.send(JSON.stringify({ type: 'error', message: 'Session not found or expired' }));
          return;
        }

        session.lastActivity = Date.now();
        currentSessionId = normalizedId;
        currentRole = role;

        if (role === 'camera') {
          session.cameraWs = ws;
          ws.send(JSON.stringify({ type: 'joined', sessionId: normalizedId }));
          broadcastToSession(session, 'viewer', { type: 'camera_joined' });
        } else if (role === 'viewer') {
          session.viewerWs = ws;
          ws.send(JSON.stringify({ type: 'joined', sessionId: normalizedId }));
        }
      } else if (data.type === 'signal') {
        if (!currentSessionId) return;
        const session = sessions.get(currentSessionId);
        if (!session) return;

        session.lastActivity = Date.now();
        const targetRole = currentRole === 'viewer' ? 'camera' : 'viewer';
        broadcastToSession(session, targetRole, {
          type: 'signal',
          payload: data.payload
        });
      } else if (data.type === 'end_session') {
        if (!currentSessionId) return;
        const session = sessions.get(currentSessionId);
        if (session) {
          broadcastToSession(session, 'camera', { type: 'session_ended' });
          sessions.delete(currentSessionId);
        }
      }
    } catch (err) {
      console.warn('WS message parsing warning:', err);
    }
  });

  ws.on('close', () => {
    if (currentSessionId) {
      const session = sessions.get(currentSessionId);
      if (session) {
        if (currentRole === 'camera') {
          session.cameraWs = undefined;
          broadcastToSession(session, 'viewer', { type: 'camera_left' });
        } else if (currentRole === 'viewer') {
          session.viewerWs = undefined;
          broadcastToSession(session, 'camera', { type: 'viewer_left' });
        }
      }
    }
  });

  ws.on('error', (err) => {
    console.warn('WS socket warning:', err.message);
  });
});

// Periodic session cleanup
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    const isExpired = now > session.expiresAt;
    const isInactive = (now - session.lastActivity) > INACTIVITY_TTL_MS &&
      !session.viewerWs && !session.cameraWs && session.sseClients.length === 0;

    if (isExpired || isInactive) {
      sessions.delete(id);
    }
  }
}, 60000);

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

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Luma Monitor server running on port ${PORT}`);
  });
}

startServer().catch(console.error);
