import Peer, { MediaConnection, DataConnection } from 'peerjs';

export interface PeerSignalingCallbacks {
  onSessionCreated?: (sessionId: string) => void;
  onCameraJoined?: () => void;
  onCameraLeft?: () => void;
  onViewerLeft?: () => void;
  onRemoteStream?: (stream: MediaStream) => void;
  onSessionEnded?: () => void;
  onError?: (errMessage: string) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

const PEER_PREFIX = 'luma-session-';

export class PeerSignalingEngine {
  private peer: Peer | null = null;
  private role: 'viewer' | 'camera';
  private callbacks: PeerSignalingCallbacks;
  private currentCall: MediaConnection | null = null;
  private dataConnection: DataConnection | null = null;
  private sessionId: string | null = null;

  constructor(role: 'viewer' | 'camera', callbacks: PeerSignalingCallbacks = {}) {
    this.role = role;
    this.callbacks = callbacks;
  }

  public async startViewerSession(): Promise<string> {
    const rawId = Math.random().toString(36).substring(2, 8).toUpperCase();
    this.sessionId = rawId;
    const peerId = `${PEER_PREFIX}${rawId}`;

    return new Promise((resolve, reject) => {
      try {
        const peer = new Peer(peerId, {
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' }
            ]
          }
        });

        this.peer = peer;

        peer.on('open', (id) => {
          this.callbacks.onConnect?.();
          this.callbacks.onSessionCreated?.(rawId);
          resolve(rawId);
        });

        // Listen for incoming data connections (for presence/events)
        peer.on('connection', (conn) => {
          this.dataConnection = conn;
          conn.on('open', () => {
            this.callbacks.onCameraJoined?.();
          });
          conn.on('data', (data: any) => {
            if (data?.type === 'camera_left') {
              this.callbacks.onCameraLeft?.();
            }
          });
          conn.on('close', () => {
            this.callbacks.onCameraLeft?.();
          });
        });

        // Listen for incoming media stream call from Android phone
        peer.on('call', (call) => {
          this.currentCall = call;
          this.callbacks.onCameraJoined?.();

          // Answer call (viewer only receives video, no need to send audio/video)
          call.answer();

          call.on('stream', (remoteStream) => {
            this.callbacks.onRemoteStream?.(remoteStream);
          });

          call.on('close', () => {
            this.callbacks.onCameraLeft?.();
          });

          call.on('error', (err) => {
            console.warn('Peer call warning:', err);
          });
        });

        peer.on('error', (err) => {
          console.warn('Peer error:', err);
          if (err.type === 'unavailable-id') {
            // Retry with new ID if collision
            resolve(this.startViewerSession());
          } else {
            this.callbacks.onError?.(err.message || 'Peer connection issue');
            reject(err);
          }
        });

        peer.on('disconnected', () => {
          this.callbacks.onDisconnect?.();
        });
      } catch (err: any) {
        reject(err);
      }
    });
  }

  public async startCameraStream(sessionId: string, localStream: MediaStream): Promise<void> {
    this.sessionId = sessionId.toUpperCase();
    const targetPeerId = `${PEER_PREFIX}${this.sessionId}`;

    return new Promise((resolve, reject) => {
      try {
        const peer = new Peer({
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' }
            ]
          }
        });
        this.peer = peer;

        peer.on('open', () => {
          this.callbacks.onConnect?.();

          // Establish data connection for presence
          const conn = peer.connect(targetPeerId);
          this.dataConnection = conn;

          conn.on('open', () => {
            this.callbacks.onCameraJoined?.();
          });

          conn.on('close', () => {
            this.callbacks.onViewerLeft?.();
          });

          // Call the viewer with the camera stream
          const call = peer.call(targetPeerId, localStream);
          this.currentCall = call;

          call.on('close', () => {
            this.callbacks.onViewerLeft?.();
          });

          call.on('error', (err) => {
            console.warn('Camera peer call warning:', err);
          });

          resolve();
        });

        peer.on('error', (err) => {
          console.warn('Camera peer error:', err);
          this.callbacks.onError?.(err.message || 'Could not connect to Mac viewer');
          reject(err);
        });

        peer.on('disconnected', () => {
          this.callbacks.onDisconnect?.();
        });
      } catch (err: any) {
        reject(err);
      }
    });
  }

  public replaceTrack(newVideoTrack: MediaStreamTrack) {
    if (this.currentCall && this.currentCall.peerConnection) {
      const senders = this.currentCall.peerConnection.getSenders();
      const videoSender = senders.find((s) => s.track?.kind === 'video');
      if (videoSender) {
        videoSender.replaceTrack(newVideoTrack).catch(console.warn);
      }
    }
  }

  public getPeerConnection(): RTCPeerConnection | null {
    return this.currentCall?.peerConnection || null;
  }

  public endSession() {
    if (this.dataConnection && this.dataConnection.open) {
      this.dataConnection.send({ type: 'session_ended' });
    }
    this.disconnect();
  }

  public disconnect() {
    if (this.currentCall) {
      this.currentCall.close();
      this.currentCall = null;
    }
    if (this.dataConnection) {
      this.dataConnection.close();
      this.dataConnection = null;
    }
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    this.callbacks.onDisconnect?.();
  }
}
