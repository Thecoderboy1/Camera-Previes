import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, Settings, HelpCircle, X, ExternalLink, ShieldCheck } from 'lucide-react';
import { SignalingChannel, TransportType } from '../lib/signaling';
import { WebRTCManager, StreamStats } from '../lib/webrtc';
import { VideoPreview, VideoState } from '../components/VideoPreview';
import { PairingPanel } from '../components/PairingPanel';
import { StatusBar } from '../components/StatusBar';

export default function DesktopDashboard() {
  const [state, setState] = useState<VideoState>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pairingUrl, setPairingUrl] = useState<string>('');
  const [transport, setTransport] = useState<TransportType>('disconnected');
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const signalingRef = useRef<SignalingChannel | null>(null);
  const rtcManagerRef = useRef<WebRTCManager | null>(null);

  const setupWebRTC = useCallback((sig: SignalingChannel) => {
    if (rtcManagerRef.current) {
      rtcManagerRef.current.close();
    }

    const rtc = new WebRTCManager({
      onTrack: (stream) => {
        setRemoteStream(stream);
        setState('streaming');
        rtc.startStatsMonitoring((s) => {
          setStats(s);
        });
      },
      onIceCandidate: (candidate) => {
        sig.sendSignal({
          type: 'candidate',
          candidate
        });
      },
      onConnectionStateChange: (connState) => {
        if (connState === 'connected') {
          setState('streaming');
        } else if (connState === 'disconnected' || connState === 'failed') {
          setState('reconnecting');
        } else if (connState === 'closed') {
          setState('disconnected');
          setRemoteStream(null);
          setStats(null);
        }
      }
    });

    rtc.initialize();
    rtcManagerRef.current = rtc;
    return rtc;
  }, []);

  const startSession = useCallback(async () => {
    // Teardown previous
    if (rtcManagerRef.current) {
      rtcManagerRef.current.close();
      rtcManagerRef.current = null;
    }
    if (signalingRef.current) {
      signalingRef.current.disconnect();
      signalingRef.current = null;
    }

    setRemoteStream(null);
    setStats(null);
    setState('idle');
    setErrorMessage('');

    const sig = new SignalingChannel('viewer', {
      onSessionCreated: (newSessionId) => {
        setSessionId(newSessionId);
        const url = `${window.location.origin}/?session=${newSessionId}`;
        setPairingUrl(url);
        setState('waiting_for_phone');
      },
      onJoined: (joinedId) => {
        setSessionId(joinedId);
        setState('waiting_for_phone');
      },
      onCameraJoined: () => {
        setState('phone_connected');
        setupWebRTC(sig);
      },
      onCameraLeft: () => {
        setState('disconnected');
        setRemoteStream(null);
        setStats(null);
        if (rtcManagerRef.current) {
          rtcManagerRef.current.close();
          rtcManagerRef.current = null;
        }
      },
      onSignal: async (payload) => {
        if (!rtcManagerRef.current) {
          setupWebRTC(sig);
        }
        const rtc = rtcManagerRef.current!;

        try {
          if (payload.type === 'offer') {
            setState('connecting');
            const answer = await rtc.handleOffer(payload);
            await sig.sendSignal(answer);
          } else if (payload.type === 'candidate' && payload.candidate) {
            await rtc.addIceCandidate(payload.candidate);
          }
        } catch (e: any) {
          console.warn('WebRTC signal handling warning:', e?.message);
        }
      },
      onError: (msg) => {
        setState('error');
        setErrorMessage(msg);
      },
      onTransportChange: (newTransport) => {
        setTransport(newTransport);
      },
      onDisconnect: () => {
        if (state === 'streaming') {
          setState('reconnecting');
        }
      }
    });

    signalingRef.current = sig;
    await sig.createSession();
  }, [setupWebRTC, state]);

  const endSession = useCallback(async () => {
    if (signalingRef.current) {
      await signalingRef.current.endSession();
      signalingRef.current = null;
    }
    if (rtcManagerRef.current) {
      rtcManagerRef.current.close();
      rtcManagerRef.current = null;
    }
    setRemoteStream(null);
    setStats(null);
    setSessionId(null);
    setPairingUrl('');
    setState('idle');
  }, []);

  useEffect(() => {
    startSession();

    return () => {
      if (signalingRef.current) signalingRef.current.disconnect();
      if (rtcManagerRef.current) rtcManagerRef.current.close();
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#0B0C0F] text-[#F4F5F7] flex flex-col font-sans selection:bg-[#A3E635] selection:text-[#0B0C0F]">
      {/* Top Navigation Bar (approx 64px high) */}
      <header className="h-16 border-b border-[#292C34] flex items-center justify-between px-6 bg-[#111318] shrink-0 select-none">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#17191F] border border-[#292C34] flex items-center justify-center">
            <Camera className="w-5 h-5 text-[#A3E635]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium tracking-tight text-sm text-[#F4F5F7]">Luma Monitor</span>
              <span className="text-[10px] font-mono text-[#969BA7] bg-[#17191F] border border-[#292C34] px-1.5 py-0.5 rounded">
                v1.0
              </span>
            </div>
            <p className="text-[11px] text-[#969BA7]">Wireless Android Camera Monitor</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Status Indicator */}
          <div className="hidden sm:flex items-center gap-2 bg-[#17191F] border border-[#292C34] px-3 py-1.5 rounded-lg text-xs">
            <span
              className={`w-2 h-2 rounded-full ${
                state === 'streaming'
                  ? 'bg-[#A3E635]'
                  : state === 'waiting_for_phone' || state === 'phone_connected'
                  ? 'bg-amber-400'
                  : state === 'error'
                  ? 'bg-[#F87171]'
                  : 'bg-[#969BA7]'
              }`}
            />
            <span className="text-[#F4F5F7] font-medium capitalize">
              {state.replace(/_/g, ' ')}
            </span>
          </div>

          <button
            onClick={() => setShowSettings(true)}
            className="p-2 text-[#969BA7] hover:text-[#F4F5F7] hover:bg-[#17191F] rounded-lg border border-transparent hover:border-[#292C34] transition-colors"
            title="Settings & Network Configuration"
          >
            <Settings className="w-4 h-4" />
          </button>

          <button
            onClick={() => setShowHelp(true)}
            className="p-2 text-[#969BA7] hover:text-[#F4F5F7] hover:bg-[#17191F] rounded-lg border border-transparent hover:border-[#292C34] transition-colors"
            title="Help & Connection Guide"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Workspace (Two-column layout: approx 72% left, 28% right) */}
      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden p-6 gap-6">
        {/* Left Column: Live Camera Preview (~72%) */}
        <div className="flex-1 flex flex-col min-w-0">
          <VideoPreview
            state={state}
            remoteStream={remoteStream}
            stats={stats}
            errorMessage={errorMessage}
            onConnectClick={startSession}
          />
        </div>

        {/* Right Column: Pairing Panel (~28%) */}
        <div className="w-full lg:w-[340px] xl:w-[380px] shrink-0 flex flex-col">
          <PairingPanel
            sessionId={sessionId}
            pairingUrl={pairingUrl}
            state={state}
            transport={transport}
            onRegenerate={startSession}
            onEndSession={endSession}
          />
        </div>
      </main>

      {/* Bottom Status Bar */}
      <StatusBar state={state} stats={stats} />

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#111318] border border-[#292C34] rounded-xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-medium text-[#F4F5F7] flex items-center gap-2">
                <Settings className="w-4 h-4 text-[#A3E635]" />
                Connection & Network Settings
              </h3>
              <button
                onClick={() => setShowSettings(false)}
                className="text-[#969BA7] hover:text-[#F4F5F7] p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs text-[#969BA7]">
              <div>
                <span className="text-[#F4F5F7] font-medium block mb-1">STUN Servers</span>
                <p className="font-mono bg-[#17191F] p-2 rounded border border-[#292C34] text-[11px]">
                  stun:stun.l.google.com:19302<br />
                  stun:stun1.l.google.com:19302
                </p>
                <p className="mt-1 text-[11px]">
                  STUN resolves public and LAN IP addresses. For isolated subnets or strict symmetrical NATs, a TURN relay can be configured.
                </p>
              </div>

              <div>
                <span className="text-[#F4F5F7] font-medium block mb-1">HTTPS Requirement for Mobile</span>
                <div className="bg-[#17191F] p-2.5 rounded border border-[#292C34] text-[11px] leading-relaxed">
                  Android Chrome requires a secure context (<span className="text-[#A3E635] font-mono">HTTPS</span>) to authorize camera access. On local networks, use the provided local tunnel or trusted local certificate.
                </div>
              </div>

              <div>
                <span className="text-[#F4F5F7] font-medium block mb-1">Signaling Engine</span>
                <div className="bg-[#17191F] p-2.5 rounded border border-[#292C34] text-[11px] flex items-center justify-between">
                  <span>Current Transport:</span>
                  <span className="font-mono text-[#F4F5F7] font-medium uppercase">{transport}</span>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setShowSettings(false)}
                className="bg-[#292C34] hover:bg-[#323640] text-[#F4F5F7] text-xs font-medium px-4 py-2 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Help Modal */}
      {showHelp && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#111318] border border-[#292C34] rounded-xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-medium text-[#F4F5F7] flex items-center gap-2">
                <HelpCircle className="w-4 h-4 text-[#A3E635]" />
                How to Pair Your Android Camera
              </h3>
              <button
                onClick={() => setShowHelp(false)}
                className="text-[#969BA7] hover:text-[#F4F5F7] p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <ol className="list-decimal list-inside space-y-3 text-xs text-[#969BA7] leading-relaxed">
              <li>
                <strong className="text-[#F4F5F7]">Scan the QR Code:</strong> Use your phone's default Camera app or Google Lens to scan the QR code on the right.
              </li>
              <li>
                <strong className="text-[#F4F5F7]">Allow Camera Permission:</strong> Tap the "Allow camera access" button on your phone.
              </li>
              <li>
                <strong className="text-[#F4F5F7]">Instant Live Stream:</strong> WebRTC will stream directly from phone to Mac at 720p/1080p with minimal latency.
              </li>
              <li>
                <strong className="text-[#F4F5F7]">Camera Switch:</strong> Use the flip icon on your phone to toggle between front and rear cameras without reconnecting.
              </li>
            </ol>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setShowHelp(false)}
                className="bg-[#A3E635] hover:bg-[#84CC16] text-[#0B0C0F] text-xs font-medium px-4 py-2 rounded-lg transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
