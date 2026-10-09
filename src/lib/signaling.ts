/**
 * Unified Signaling Engine for Luma Monitor
 * Supports:
 * 1. Dedicated Python FastAPI / Node Backend (WebSockets + REST + SSE) via VITE_BACKEND_URL or local server
 * 2. Cloud PeerJS WebRTC (zero-setup fallback when deployed to static hosts without backend)
 */

import { PeerSignalingEngine } from './peerSignaling';

export type SignalingRole = 'viewer' | 'camera';
export type TransportType = 'cloud-peer' | 'websocket' | 'sse' | 'polling' | 'disconnected';
export type SignalingMode = 'auto' | 'cloud' | 'local';

export interface SignalingCallbacks {
  onSessionCreated?: (sessionId: string, token: string) => void;
  onJoined?: (sessionId: string) => void;
  onCameraJoined?: () => void;
  onCameraLeft?: () => void;
  onViewerLeft?: () => void;
  onSignal?: (payload: any) => void;
  onRemoteStream?: (stream: MediaStream) => void;
  onSessionEnded?: () => void;
  onError?: (message: string) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onTransportChange?: (transport: TransportType) => void;
}

export function isStaticHosting(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname.toLowerCase();
  return (
    host.includes('netlify.app') ||
    host.includes('vercel.app') ||
    host.includes('github.io') ||
    host.includes('surge.sh') ||
    host.includes('firebaseapp.com') ||
    host.includes('web.app')
  );
}

export class SignalingChannel {
  private ws: WebSocket | null = null;
  private eventSource: EventSource | null = null;
  private pollInterval: number | null = null;
  private pingInterval: number | null = null;
  private peerEngine: PeerSignalingEngine | null = null;
  private role: SignalingRole;
  private sessionId: string | null = null;
  private callbacks: SignalingCallbacks;
  private isDestroyed = false;
  private transport: TransportType = 'disconnected';
  private mode: SignalingMode;
  private customBackendUrl: string = '';

  constructor(
    role: SignalingRole,
    callbacks: SignalingCallbacks = {},
    mode: SignalingMode = 'auto',
    customBackendUrl = ''
  ) {
    this.role = role;
    this.callbacks = callbacks;
    this.mode = mode;

    const envBackend = (import.meta.env.VITE_BACKEND_URL as string) || '';
    const rawUrl = customBackendUrl || envBackend;
    this.customBackendUrl = rawUrl ? rawUrl.replace(/\/$/, '') : '';
  }

  private setTransport(transport: TransportType) {
    if (this.transport !== transport) {
      this.transport = transport;
      this.callbacks.onTransportChange?.(transport);
    }
  }

  public getTransport(): TransportType {
    return this.transport;
  }

  public getPeerEngine(): PeerSignalingEngine | null {
    return this.peerEngine;
  }

  public isCloudPeerMode(): boolean {
    return this.shouldUseCloudPeer();
  }

  public shouldUseCloudPeer(): boolean {
    if (this.mode === 'cloud') return true;
    if (this.mode === 'local') return false;

    // Auto mode:
    // If backend URL is explicitly configured, use the backend!
    if (this.getBaseApiUrl()) {
      return false;
    }

    // Otherwise, if running on a static host like Netlify or Vercel, default to Cloud Peer
    return isStaticHosting();
  }

  public getBaseApiUrl(): string {
    return this.customBackendUrl;
  }

  public getWsUrl(): string {
    const envWs = import.meta.env.VITE_WS_URL as string;
    if (envWs) {
      return envWs.endsWith('/ws') ? envWs : `${envWs.replace(/\/$/, '')}/ws`;
    }

    const base = this.getBaseApiUrl();
    if (base) {
      try {
        const url = new URL(base);
        const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${wsProtocol}//${url.host}/ws`;
      } catch {
        // Fallback below
      }
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  }

  /**
   * Start session creation for viewer
   */
  public async createSession(): Promise<string> {
    if (this.shouldUseCloudPeer()) {
      return this.createCloudPeerSession();
    }

    const baseApi = this.getBaseApiUrl();
    const endpoint = baseApi ? `${baseApi}/api/sessions` : '/api/sessions';

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        // If 404 on a static host without a configured backend, gracefully fall back
        if ((response.status === 404 || response.status === 502) && !baseApi && isStaticHosting()) {
          console.info('No backend server detected at origin, switching to Cloud WebRTC signaling.');
          return this.createCloudPeerSession();
        }

        const errText = await response.text().catch(() => '');
        throw new Error(
          `Backend returned ${response.status} (${response.statusText}): ${errText || 'Failed to create session on server'}`
        );
      }

      const data = await response.json();
      this.sessionId = data.sessionId;
      this.callbacks.onSessionCreated?.(data.sessionId, data.token || '');
      this.connect(data.sessionId);
      return data.sessionId;
    } catch (err: any) {
      // If user did not specify a custom backend and is on a static host, fallback
      if (!baseApi && isStaticHosting()) {
        console.info('Backend unreachable, using Cloud WebRTC peer signaling.');
        return this.createCloudPeerSession();
      }

      const msg = err?.message || 'Failed to connect to backend server';
      this.callbacks.onError?.(`${msg}. Check backend URL (${baseApi || 'same origin'}) and ensure the FastAPI server is running.`);
      return '';
    }
  }

  private async createCloudPeerSession(): Promise<string> {
    this.setTransport('cloud-peer');
    this.peerEngine = new PeerSignalingEngine('viewer', {
      onConnect: () => {
        this.setTransport('cloud-peer');
        this.callbacks.onConnect?.();
      },
      onSessionCreated: (id) => {
        this.sessionId = id;
        this.callbacks.onSessionCreated?.(id, 'cloud');
      },
      onCameraJoined: () => {
        this.callbacks.onCameraJoined?.();
      },
      onCameraLeft: () => {
        this.callbacks.onCameraLeft?.();
      },
      onRemoteStream: (stream) => {
        this.callbacks.onRemoteStream?.(stream);
      },
      onDisconnect: () => {
        this.setTransport('disconnected');
        this.callbacks.onDisconnect?.();
      },
      onError: (msg) => {
        this.callbacks.onError?.(msg);
      }
    });

    return await this.peerEngine.startViewerSession();
  }

  /**
   * Connect to an existing session (used by phone camera or viewer rejoin)
   */
  public connect(sessionId: string, localStream?: MediaStream) {
    this.sessionId = sessionId.toUpperCase();
    this.isDestroyed = false;

    if (this.shouldUseCloudPeer()) {
      this.connectCloudPeer(this.sessionId, localStream);
      return;
    }

    // Try WebSocket with configured/local backend
    this.connectWs(this.sessionId);
  }

  public async connectCloudPeer(sessionId: string, localStream?: MediaStream) {
    this.sessionId = sessionId.toUpperCase();
    this.setTransport('cloud-peer');

    if (this.role === 'camera' && localStream) {
      this.peerEngine = new PeerSignalingEngine('camera', {
        onConnect: () => {
          this.setTransport('cloud-peer');
          this.callbacks.onConnect?.();
        },
        onCameraJoined: () => {
          this.callbacks.onJoined?.(sessionId);
        },
        onViewerLeft: () => {
          this.callbacks.onViewerLeft?.();
        },
        onError: (msg) => {
          this.callbacks.onError?.(msg);
        },
        onDisconnect: () => {
          this.setTransport('disconnected');
          this.callbacks.onDisconnect?.();
        }
      });

      await this.peerEngine.startCameraStream(sessionId, localStream);
    }
  }

  private connectWs(sessionId: string) {
    try {
      const wsUrl = this.getWsUrl();
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      const connectionTimeout = window.setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          ws.close();
          this.fallbackFromWs(sessionId);
        }
      }, 4000);

      ws.onopen = () => {
        clearTimeout(connectionTimeout);
        this.setTransport('websocket');
        this.callbacks.onConnect?.();

        ws.send(JSON.stringify({
          type: 'join_session',
          sessionId,
          role: this.role
        }));

        // Keepalive ping every 25 seconds
        if (this.pingInterval) clearInterval(this.pingInterval);
        this.pingInterval = window.setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleIncomingMessage(msg);
        } catch {}
      };

      ws.onerror = () => {
        clearTimeout(connectionTimeout);
      };

      ws.onclose = () => {
        clearTimeout(connectionTimeout);
        if (this.pingInterval) {
          clearInterval(this.pingInterval);
          this.pingInterval = null;
        }
        this.ws = null;
        if (!this.isDestroyed) {
          this.fallbackFromWs(sessionId);
        }
      };
    } catch {
      this.fallbackFromWs(sessionId);
    }
  }

  private fallbackFromWs(sessionId: string) {
    if (this.isDestroyed) return;

    // If static hosting with no backend, prefer cloud peer directly
    if (isStaticHosting() && !this.getBaseApiUrl()) {
      this.setTransport('cloud-peer');
      return;
    }

    // Try SSE on configured backend
    this.connectHttpFallback(sessionId);
  }

  private connectHttpFallback(sessionId: string) {
    if (this.isDestroyed) return;

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    const base = this.getBaseApiUrl();
    const sseUrl = `${base}/api/sessions/${encodeURIComponent(sessionId)}/events?role=${encodeURIComponent(this.role)}`;

    try {
      const es = new EventSource(sseUrl);
      this.eventSource = es;

      es.onopen = () => {
        this.setTransport('sse');
        this.callbacks.onConnect?.();
        if (this.role === 'camera') {
          this.callbacks.onJoined?.(sessionId);
        }
      };

      es.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleIncomingMessage(msg);
        } catch {}
      };

      es.onerror = () => {
        if (this.eventSource) {
          this.eventSource.close();
          this.eventSource = null;
        }
        if (!base && isStaticHosting()) {
          this.setTransport('cloud-peer');
        } else {
          this.startPolling(sessionId);
        }
      };
    } catch {
      this.startPolling(sessionId);
    }
  }

  private startPolling(sessionId: string) {
    if (this.pollInterval || this.isDestroyed) return;
    this.setTransport('polling');
    this.callbacks.onConnect?.();

    const base = this.getBaseApiUrl();

    if (this.role === 'camera') {
      this.callbacks.onJoined?.(sessionId);
      fetch(`${base}/api/sessions/${encodeURIComponent(sessionId)}/signal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'camera', type: 'camera_joined' })
      }).catch(() => {});
    }

    this.pollInterval = window.setInterval(async () => {
      if (this.isDestroyed || !this.sessionId) return;
      try {
        const res = await fetch(`${base}/api/sessions/${encodeURIComponent(sessionId)}/messages?role=${encodeURIComponent(this.role)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.messages && Array.isArray(data.messages)) {
            for (const msg of data.messages) {
              this.handleIncomingMessage(msg);
            }
          }
        }
      } catch {}
    }, 1200);
  }

  private handleIncomingMessage(msg: any) {
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case 'session_created':
        this.sessionId = msg.sessionId;
        this.callbacks.onSessionCreated?.(msg.sessionId, msg.token || '');
        break;
      case 'joined':
      case 'connected':
        if (this.sessionId) {
          this.callbacks.onJoined?.(this.sessionId);
        }
        break;
      case 'camera_joined':
        this.callbacks.onCameraJoined?.();
        break;
      case 'camera_left':
        this.callbacks.onCameraLeft?.();
        break;
      case 'viewer_left':
        this.callbacks.onViewerLeft?.();
        break;
      case 'signal':
        if (msg.payload) {
          this.callbacks.onSignal?.(msg.payload);
        }
        break;
      case 'session_ended':
        this.callbacks.onSessionEnded?.();
        break;
      case 'error':
        this.callbacks.onError?.(msg.message || 'Unknown signaling error');
        break;
    }
  }

  public async sendSignal(payload: any) {
    if (this.transport === 'cloud-peer') {
      return;
    }

    if (!this.sessionId) return;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'signal',
        sessionId: this.sessionId,
        role: this.role,
        payload
      }));
      return;
    }

    const base = this.getBaseApiUrl();
    try {
      await fetch(`${base}/api/sessions/${encodeURIComponent(this.sessionId)}/signal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: this.role,
          payload
        })
      });
    } catch {}
  }

  public async endSession() {
    if (this.peerEngine) {
      this.peerEngine.endSession();
    }

    if (!this.sessionId) return;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'end_session',
        sessionId: this.sessionId,
        role: this.role
      }));
    }

    const base = this.getBaseApiUrl();
    try {
      await fetch(`${base}/api/sessions/${encodeURIComponent(this.sessionId)}/end`, {
        method: 'POST'
      });
    } catch {}

    this.disconnect();
  }

  public disconnect() {
    this.isDestroyed = true;
    if (this.peerEngine) {
      this.peerEngine.disconnect();
      this.peerEngine = null;
    }
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this.pollInterval !== null) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.setTransport('disconnected');
    this.callbacks.onDisconnect?.();
  }
}
