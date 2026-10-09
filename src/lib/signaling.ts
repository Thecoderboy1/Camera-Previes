/**
 * Unified Signaling Engine for Luma Monitor
 * Supports Cloud PeerJS WebRTC (ideal for Netlify & static hosts)
 * and Local Backend (FastAPI / Express via WebSocket + SSE)
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
  private peerEngine: PeerSignalingEngine | null = null;
  private role: SignalingRole;
  private sessionId: string | null = null;
  private callbacks: SignalingCallbacks;
  private isDestroyed = false;
  private transport: TransportType = 'disconnected';
  private mode: SignalingMode;
  private customBackendUrl: string = '';

  constructor(role: SignalingRole, callbacks: SignalingCallbacks = {}, mode: SignalingMode = 'auto', customBackendUrl = '') {
    this.role = role;
    this.callbacks = callbacks;
    this.mode = mode;
    this.customBackendUrl = customBackendUrl.replace(/\/$/, '');
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

  private shouldUseCloudPeer(): boolean {
    if (this.mode === 'cloud') return true;
    if (this.mode === 'local') return false;
    // Auto mode: use Cloud Peer on Netlify / static hosts, or if no custom backend is set
    return isStaticHosting();
  }

  private getBaseApiUrl(): string {
    return this.customBackendUrl || '';
  }

  private getWsUrl(): string {
    if (this.customBackendUrl) {
      const url = new URL(this.customBackendUrl);
      const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${wsProtocol}//${url.host}/ws`;
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

    try {
      const response = await fetch(`${this.getBaseApiUrl()}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        // If 404 (e.g. deployed on Netlify or backend not found), fall back to Cloud Peer
        if (response.status === 404 || response.status === 502) {
          console.info('No backend server detected at origin, switching to Cloud WebRTC signaling.');
          return this.createCloudPeerSession();
        }
        throw new Error('Failed to create session on server');
      }

      const data = await response.json();
      this.sessionId = data.sessionId;
      this.callbacks.onSessionCreated?.(data.sessionId, data.token || '');
      this.connect(data.sessionId);
      return data.sessionId;
    } catch {
      // Graceful fallback to Cloud Peer WebRTC
      console.info('Backend unreachable, using Cloud WebRTC peer signaling.');
      return this.createCloudPeerSession();
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

    // Try WebSocket with local backend
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
      }, 3000);

      ws.onopen = () => {
        clearTimeout(connectionTimeout);
        this.setTransport('websocket');
        this.callbacks.onConnect?.();

        ws.send(JSON.stringify({
          type: 'join_session',
          sessionId,
          role: this.role
        }));
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

    // If static hosting, prefer cloud peer directly
    if (isStaticHosting()) {
      this.setTransport('cloud-peer');
      return;
    }

    // Try SSE
    this.connectHttpFallback(sessionId);
  }

  private connectHttpFallback(sessionId: string) {
    if (this.isDestroyed) return;

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    try {
      const sseUrl = `${this.getBaseApiUrl()}/api/sessions/${encodeURIComponent(sessionId)}/events?role=${encodeURIComponent(this.role)}`;
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
        // If SSE fails (like 404 on Netlify), switch to Cloud Peer
        this.setTransport('cloud-peer');
      };
    } catch {
      this.setTransport('cloud-peer');
    }
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
      // PeerJS handles signaling internally
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

    try {
      await fetch(`${this.getBaseApiUrl()}/api/sessions/${encodeURIComponent(this.sessionId)}/signal`, {
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

    try {
      await fetch(`${this.getBaseApiUrl()}/api/sessions/${encodeURIComponent(this.sessionId)}/end`, {
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
