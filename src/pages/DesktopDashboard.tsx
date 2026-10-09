import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, Settings, HelpCircle, X, Server, Cloud, Check, ExternalLink, Activity } from 'lucide-react';
import { SignalingChannel, TransportType, SignalingMode, isStaticHosting } from '../lib/signaling';
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

  // Settings state
  const envBackendUrl = (import.meta.env.VITE_BACKEND_URL as string) || '';
  const [signalingMode, setSignalingMode] = useState<SignalingMode>(() => {
    const saved = localStorage.getItem('luma_signaling_mode') as SignalingMode;
    if (saved) return saved;
    if (envBackendUrl) return 'local';
    return isStaticHosting() ? 'cloud' : 'auto';
  });
  const [customBackendUrl, setCustomBackendUrl] = useState(() => {
    return localStorage.getItem('luma_backend_url') || envBackendUrl;
  });
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [settingsSaved, setSettingsSaved] = useState(false);

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

  const buildPairingUrl = useCallback((newSessionId: string, currentMode: SignalingMode, backendUrl: string) => {
    const url = new URL(window.location.origin);
    url.searchParams.set('session', newSessionId);
    if (backendUrl) {
      url.searchParams.set('backend', backendUrl);
    }
    if (currentMode === 'cloud') {
      url.searchParams.set('mode', 'cloud');
    }
    return url.toString();
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

    const sig = new SignalingChannel(
      'viewer',
      {
        onSessionCreated: (newSessionId) => {
          setSessionId(newSessionId);
          const generatedUrl = buildPairingUrl(newSessionId, signalingMode, customBackendUrl);
          setPairingUrl(generatedUrl);
          setState('waiting_for_phone');
        },
        onJoined: (joinedId) => {
          setSessionId(joinedId);
          setState('waiting_for_phone');
        },
        onCameraJoined: () => {
          setState('phone_connected');
          if (sig.getTransport() !== 'cloud-peer') {
            setupWebRTC(sig);
          }
        },
        onRemoteStream: (stream) => {
          setRemoteStream(stream);
          setState('streaming');
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
      },
      signalingMode,
      customBackendUrl
    );

    signalingRef.current = sig;
    await sig.createSession();
  }, [setupWebRTC, signalingMode, customBackendUrl, buildPairingUrl, state]);

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

  const testBackendConnection = async () => {
    const targetUrl = customBackendUrl.replace(/\/$/, '');
    if (!targetUrl) {
      setTestStatus('failed');
      setTestMessage('Please enter a backend URL (e.g. http://192.168.1.50:8000 or https://your-backend.onrender.com)');
      return;
    }

    setTestStatus('testing');
    setTestMessage('Pinging /health endpoint...');

    try {
      const res = await fetch(`${targetUrl}/health`, { method: 'GET' });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        setTestStatus('success');
        setTestMessage(`Connected! Server status: ${data.status || 'ok'}`);
      } else {
        setTestStatus('failed');
        setTestMessage(`Server returned HTTP ${res.status}: ${res.statusText}`);
      }
    } catch (err: any) {
      setTestStatus('failed');
      setTestMessage(`Could not reach server (${err.message || 'Network Error'}). Check if backend is running and CORS is enabled.`);
    }
  };

  const saveSettings = () => {
    localStorage.setItem('luma_signaling_mode', signalingMode);
    localStorage.setItem('luma_backend_url', customBackendUrl);
    setSettingsSaved(true);
    setTimeout(() => {
      setSettingsSaved(false);
      setShowSettings(false);
      startSession();
    }, 600);
  };

  useEffect(() => {
    startSession();

    return () => {
      if (signalingRef.current) signalingRef.current.disconnect();
      if (rtcManagerRef.current) rtcManagerRef.current.close();
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#0B0C0F] text-[#F4F5F7] flex flex-col font-sans selection:bg-[#A3E635] selection:text-[#0B0C0F]">
      {/* Top Navigation Bar */}
      <header className="h-16 border-b border-[#292C34] flex items-center justify-between px-6 bg-[#111318] shrink-0 select-none">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#17191F] border border-[#292C34] flex items-center justify-center">
            <Camera className="w-5 h-5 text-[#A3E635]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium tracking-tight text-sm text-[#F4F5F7]">Luma Monitor</span>
              <span className="text-[10px] font-mono text-[#969BA7] bg-[#17191F] border border-[#292C34] px-1.5 py-0.5 rounded">
                v1.1
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

      {/* Main Workspace */}
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
      <StatusBar
        state={state}
        stats={stats}
        connectionMethod={
          transport === 'cloud-peer'
            ? 'Cloud WebRTC (P2P Mesh)'
            : transport === 'websocket'
            ? 'Persistent WSS Backend'
            : 'Local Wi-Fi Signaling'
        }
      />

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#111318] border border-[#292C34] rounded-xl max-w-lg w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-medium text-[#F4F5F7] flex items-center gap-2">
                <Settings className="w-4 h-4 text-[#A3E635]" />
                Connection & Backend Architecture
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
                <label className="text-[#F4F5F7] font-medium block mb-1.5">Signaling Architecture</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSignalingMode('cloud')}
                    className={`p-3 rounded-lg border text-left flex flex-col gap-1 transition-all ${
                      signalingMode === 'cloud'
                        ? 'bg-[#17191F] border-[#A3E635] text-[#F4F5F7]'
                        : 'bg-[#17191F]/50 border-[#292C34] text-[#969BA7] hover:border-[#383C47]'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-medium">
                      <Cloud className="w-3.5 h-3.5 text-[#A3E635]" />
                      <span>Cloud WebRTC</span>
                    </div>
                    <span className="text-[10px] text-[#969BA7] leading-tight">
                      Zero backend needed. Ideal for Netlify, Vercel & static hosting.
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSignalingMode('local')}
                    className={`p-3 rounded-lg border text-left flex flex-col gap-1 transition-all ${
                      signalingMode === 'local'
                        ? 'bg-[#17191F] border-[#A3E635] text-[#F4F5F7]'
                        : 'bg-[#17191F]/50 border-[#292C34] text-[#969BA7] hover:border-[#383C47]'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-medium">
                      <Server className="w-3.5 h-3.5 text-blue-400" />
                      <span>Dedicated Backend</span>
                    </div>
                    <span className="text-[10px] text-[#969BA7] leading-tight">
                      Connects to Python FastAPI backend (Render, Railway, or local Mac).
                    </span>
                  </button>
                </div>
              </div>

              {signalingMode === 'local' && (
                <div className="bg-[#17191F] p-3.5 rounded-lg border border-[#292C34] space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[#F4F5F7] font-medium">FastAPI Backend URL</label>
                    <button
                      type="button"
                      onClick={testBackendConnection}
                      disabled={testStatus === 'testing'}
                      className="text-[11px] text-[#A3E635] hover:underline flex items-center gap-1"
                    >
                      <Activity className="w-3 h-3" />
                      Test Connection
                    </button>
                  </div>

                  <input
                    type="text"
                    value={customBackendUrl}
                    onChange={(e) => {
                      setCustomBackendUrl(e.target.value);
                      setTestStatus('idle');
                    }}
                    placeholder="e.g. https://luma-backend.onrender.com or http://192.168.1.50:8000"
                    className="w-full bg-[#111318] border border-[#292C34] text-[#F4F5F7] px-3 py-2 rounded-lg font-mono text-xs outline-none focus:border-[#A3E635]"
                  />

                  {testStatus !== 'idle' && (
                    <div className={`p-2 rounded text-[11px] ${
                      testStatus === 'success'
                        ? 'bg-[#A3E635]/10 text-[#A3E635] border border-[#A3E635]/20'
                        : testStatus === 'testing'
                        ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                        : 'bg-[#F87171]/10 text-[#F87171] border border-[#F87171]/20'
                    }`}>
                      {testMessage}
                    </div>
                  )}

                  <p className="text-[10px] text-[#969BA7] leading-relaxed">
                    Set this if your frontend is deployed on Vercel/Netlify while the Python backend runs separately on Render, Railway, Fly.io, or your Mac. Leave blank to connect to same-origin.
                  </p>
                </div>
              )}

              <div className="border-t border-[#292C34] pt-3">
                <span className="text-[#F4F5F7] font-medium block mb-1">Active Signaling Transport</span>
                <div className="bg-[#17191F] p-2.5 rounded border border-[#292C34] text-[11px] flex items-center justify-between">
                  <span>Current Transport:</span>
                  <span className="font-mono text-[#F4F5F7] font-medium uppercase">{transport}</span>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="bg-transparent hover:bg-[#17191F] text-[#969BA7] text-xs font-medium px-4 py-2 rounded-lg transition-colors border border-transparent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveSettings}
                className="bg-[#A3E635] hover:bg-[#84CC16] text-[#0B0C0F] text-xs font-medium px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
              >
                {settingsSaved ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    Saved!
                  </>
                ) : (
                  'Apply & Reconnect'
                )}
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
                <strong className="text-[#F4F5F7]">Instant Live Stream:</strong> WebRTC streams video directly from phone to Mac with minimal latency.
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
