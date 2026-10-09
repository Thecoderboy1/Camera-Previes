/**
 * WebRTC Peer Connection Manager for Luma Monitor
 */

export interface PeerConnectionConfig {
  iceServers?: RTCIceServer[];
  onTrack?: (stream: MediaStream) => void;
  onIceCandidate?: (candidate: RTCIceCandidate) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
}

export interface StreamStats {
  width: number;
  height: number;
  fps: number;
  bitrateKbps?: number;
}

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' }
];

export class WebRTCManager {
  private pc: RTCPeerConnection | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private isRemoteDescriptionSet = false;
  private config: PeerConnectionConfig;
  private statsInterval: number | null = null;
  private lastBytesReceived = 0;
  private lastStatsTimestamp = 0;

  constructor(config: PeerConnectionConfig = {}) {
    this.config = config;
  }

  public initialize(): RTCPeerConnection {
    if (this.pc) {
      this.close();
    }

    const rtcConfig: RTCConfiguration = {
      iceServers: this.config.iceServers || DEFAULT_ICE_SERVERS,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    };

    const pc = new RTCPeerConnection(rtcConfig);
    this.pc = pc;
    this.isRemoteDescriptionSet = false;
    this.pendingCandidates = [];

    pc.onicecandidate = (event) => {
      if (event.candidate && this.config.onIceCandidate) {
        this.config.onIceCandidate(event.candidate);
      }
    };

    pc.ontrack = (event) => {
      if (event.streams && event.streams[0] && this.config.onTrack) {
        this.config.onTrack(event.streams[0]);
      }
    };

    pc.onconnectionstatechange = () => {
      if (this.config.onConnectionStateChange) {
        this.config.onConnectionStateChange(pc.connectionState);
      }
    };

    return pc;
  }

  public async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (!this.pc) this.initialize();
    const pc = this.pc!;

    const offer = await pc.createOffer({
      offerToReceiveVideo: true,
      offerToReceiveAudio: false
    });
    await pc.setLocalDescription(offer);
    return pc.localDescription || offer;
  }

  public async handleOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    if (!this.pc) this.initialize();
    const pc = this.pc!;

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    this.isRemoteDescriptionSet = true;
    await this.processPendingCandidates();

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    return pc.localDescription || answer;
  }

  public async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.pc) return;
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    this.isRemoteDescriptionSet = true;
    await this.processPendingCandidates();
  }

  public async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc || !this.isRemoteDescriptionSet) {
      this.pendingCandidates.push(candidate);
      return;
    }

    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn('ICE candidate addition warning:', err);
    }
  }

  private async processPendingCandidates(): Promise<void> {
    if (!this.pc) return;
    while (this.pendingCandidates.length > 0) {
      const candidate = this.pendingCandidates.shift();
      if (candidate) {
        try {
          await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.warn('Queued ICE candidate warning:', err);
        }
      }
    }
  }

  public addTracks(stream: MediaStream): void {
    if (!this.pc) this.initialize();
    const pc = this.pc!;
    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });
  }

  public async replaceVideoTrack(newTrack: MediaStreamTrack): Promise<boolean> {
    if (!this.pc) return false;
    const senders = this.pc.getSenders();
    const videoSender = senders.find((s) => s.track?.kind === 'video');
    if (videoSender) {
      await videoSender.replaceTrack(newTrack);
      return true;
    }
    return false;
  }

  public startStatsMonitoring(onStats: (stats: StreamStats) => void, intervalMs = 1500): void {
    this.stopStatsMonitoring();

    this.statsInterval = window.setInterval(async () => {
      if (!this.pc || this.pc.connectionState !== 'connected') return;

      try {
        const stats = await this.pc.getStats();
        let width = 0;
        let height = 0;
        let fps = 0;
        let currentBytesReceived = 0;

        stats.forEach((report) => {
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            if (report.frameWidth) width = report.frameWidth;
            if (report.frameHeight) height = report.frameHeight;
            if (report.framesPerSecond) fps = Math.round(report.framesPerSecond);
            if (report.bytesReceived) currentBytesReceived = report.bytesReceived;
          }
        });

        const now = Date.now();
        let bitrateKbps: number | undefined;

        if (this.lastStatsTimestamp > 0 && currentBytesReceived > this.lastBytesReceived) {
          const timeDiff = (now - this.lastStatsTimestamp) / 1000;
          const bytesDiff = currentBytesReceived - this.lastBytesReceived;
          bitrateKbps = Math.round((bytesDiff * 8) / (timeDiff * 1024));
        }

        this.lastBytesReceived = currentBytesReceived;
        this.lastStatsTimestamp = now;

        if (width > 0 && height > 0) {
          onStats({ width, height, fps, bitrateKbps });
        }
      } catch (e) {
        // Stats error ignored
      }
    }, intervalMs);
  }

  public stopStatsMonitoring(): void {
    if (this.statsInterval !== null) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    this.lastBytesReceived = 0;
    this.lastStatsTimestamp = 0;
  }

  public close(): void {
    this.stopStatsMonitoring();
    if (this.pc) {
      this.pc.ontrack = null;
      this.pc.onicecandidate = null;
      this.pc.onconnectionstatechange = null;
      this.pc.close();
      this.pc = null;
    }
    this.pendingCandidates = [];
    this.isRemoteDescriptionSet = false;
  }

  public getConnectionState(): RTCPeerConnectionState {
    return this.pc?.connectionState || 'closed';
  }
}
