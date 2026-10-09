/**
 * Resilient Signaling Engine for Luma Monitor
 * Supports WebSocket as primary transport with seamless SSE/HTTP fallback
 */

export type SignalingRole = 'viewer' | 'camera';
export type TransportType = 'websocket' | 'sse' | 'polling' | 'disconnected';

export interface SignalingCallbacks {
  onSessionCreated?: (sessionId: string, token: string) => void;
  onJoined?: (sessionId: string) => void;
  onCameraJoined?: () => void;
  onCameraLeft?: () => void;
  onViewerLeft?: () => void;
  onSignal?: (payload: any) => void;
  onSessionEnded?: () => void;
  onError?: (message: string) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onTransportChange?: (transport: TransportType) => void;
}

export class SignalingChannel {
  private ws: WebSocket | null = null;
  private eventSource: EventSource | null = null;
  private pollInterval: number | null = null;
  private role: SignalingRole;
  private sessionId: string | null = null;
  private callbacks: SignalingCallbacks;
  private isDestroyed = false;
  private transport: TransportType = 'disconnected';
  private wsFailed = false;

  constructor(role: SignalingRole, callbacks: SignalingCallbacks = {}) {
    this.role = role;
    this.callbacks = callbacks;
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

  private getWsUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  }

  /**
   * Start session creation for viewer
   */
  public async createSession(): Promise<string> {
    try {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!response.ok) throw new Error('Failed to create session on server');
      const data = await response.json();
      this.sessionId = data.sessionId;
      this.callbacks.onSessionCreated?.(data.sessionId, data.token);

      // Now connect signaling for this session
      this.connect(data.sessionId);
      return data.sessionId;
    } catch (err: any) {
      console.warn('REST session creation fallback error, trying WS:', err?.message);
      // Try WebSocket create_session
      this.connectWs(null);
      return '';
    }
  }

  /**
   * Connect to an existing session
   */
  public connect(sessionId: string) {
    this.sessionId = sessionId;
    this.isDestroyed = false;

    // Try WebSocket first unless already failed
    if (!this.wsFailed) {
      this.connectWs(sessionId);
    } else {
      this.connectHttpFallback(sessionId);
    }
  }

  private connectWs(sessionId: string | null) {
    try {
      const wsUrl = this.getWsUrl();
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      const connectionTimeout = window.setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          console.info('WebSocket connection timed out, switching to HTTP fallback.');
          ws.close();
          this.wsFailed = true;
          if (this.sessionId) this.connectHttpFallback(this.sessionId);
        }
      }, 3500);

      ws.onopen = () => {
        clearTimeout(connectionTimeout);
        this.setTransport('websocket');
        this.callbacks.onConnect?.();

        if (this.role === 'viewer') {
          if (sessionId) {
            ws.send(JSON.stringify({ type: 'join_session', sessionId, role: 'viewer' }));
          } else {
            ws.send(JSON.stringify({ type: 'create_session' }));
          }
        } else if (sessionId) {
          ws.send(JSON.stringify({ type: 'join_session', sessionId, role: 'camera' }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleIncomingMessage(msg);
        } catch (e) {
          console.warn('WS parse warning:', e);
        }
      };

      ws.onerror = () => {
        clearTimeout(connectionTimeout);
        // Do not use console.error to avoid unhandled browser alert
        console.info('WebSocket not available on this origin/proxy, transitioning to HTTP transport.');
        this.wsFailed = true;
      };

      ws.onclose = () => {
        clearTimeout(connectionTimeout);
        this.ws = null;
        if (!this.isDestroyed && this.sessionId) {
          // Gracefully fallback to SSE/HTTP
          this.setTransport('disconnected');
          this.connectHttpFallback(this.sessionId);
        } else {
          this.setTransport('disconnected');
          this.callbacks.onDisconnect?.();
        }
      };
    } catch {
      this.wsFailed = true;
      if (sessionId) this.connectHttpFallback(sessionId);
    }
  }

  private connectHttpFallback(sessionId: string) {
    if (this.isDestroyed) return;
    this.sessionId = sessionId;

    // Close any previous SSE
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    try {
      const sseUrl = `/api/sessions/${encodeURIComponent(sessionId)}/events?role=${encodeURIComponent(this.role)}`;
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
        } catch {
          // Keepalive or unparseable ignored
        }
      };

      es.onerror = () => {
        // Fall back to polling if SSE is blocked
        if (this.eventSource) {
          this.eventSource.close();
          this.eventSource = null;
        }
        if (!this.isDestroyed) {
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

    if (this.role === 'camera') {
      this.callbacks.onJoined?.(sessionId);
      fetch(`/api/sessions/${encodeURIComponent(sessionId)}/signal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'camera', type: 'camera_joined' })
      }).catch(() => {});
    }

    this.pollInterval = window.setInterval(async () => {
      if (this.isDestroyed || !this.sessionId) return;
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages?role=${encodeURIComponent(this.role)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.messages && Array.isArray(data.messages)) {
            for (const msg of data.messages) {
              this.handleIncomingMessage(msg);
            }
          }
        }
      } catch {
        // Polling failure handled silently
      }
    }, 1000);
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

  /**
   * Send a WebRTC signal (offer, answer, candidate)
   */
  public async sendSignal(payload: any) {
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

    // HTTP POST fallback
    try {
      await fetch(`/api/sessions/${encodeURIComponent(this.sessionId)}/signal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: this.role,
          payload
        })
      });
    } catch (e: any) {
      console.warn('Signal dispatch warning:', e?.message);
    }
  }

  /**
   * End current session
   */
  public async endSession() {
    if (!this.sessionId) return;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'end_session',
        sessionId: this.sessionId,
        role: this.role
      }));
    }

    try {
      await fetch(`/api/sessions/${encodeURIComponent(this.sessionId)}/end`, {
        method: 'POST'
      });
    } catch {
      // Ignored
    }

    this.disconnect();
  }

  public disconnect() {
    this.isDestroyed = true;
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
