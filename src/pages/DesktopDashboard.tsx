import React, { useEffect, useRef, useState } from 'react';
import { Camera, Settings, HelpCircle, Monitor, Maximize, Minimize, RefreshCw, X, Check, Copy } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { SignalingChannel } from '../lib/signaling';
import clsx from 'clsx';

type ConnectionState = 'idle' | 'session_created' | 'waiting_for_phone' | 'phone_connected' | 'connecting' | 'streaming' | 'disconnected' | 'error';

export default function DesktopDashboard() {
  const [state, setState] = useState<ConnectionState>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pairingUrl, setPairingUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [fitMode, setFitMode] = useState<'contain' | 'cover'>('contain');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [resolution, setResolution] = useState<string>('');
  const [fps, setFps] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const signalingRef = useRef<SignalingChannel | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const statsIntervalRef = useRef<number | null>(null);

  const getWsUrl = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  };

  const createPeerConnection = () => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && signalingRef.current) {
        signalingRef.current.send({
          type: 'signal',
          payload: { type: 'candidate', candidate: event.candidate }
        });
      }
    };

    pc.ontrack = (event) => {
      if (videoRef.current && event.streams[0]) {
        videoRef.current.srcObject = event.streams[0];
        setState('streaming');
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        setState('disconnected');
        if (videoRef.current) videoRef.current.srcObject = null;
      }
    };

    return pc;
  };

  const setupSignaling = () => {
    if (signalingRef.current) signalingRef.current.disconnect();

    const sig = new SignalingChannel(
      getWsUrl(),
      async (msg) => {
        if (msg.type === 'session_created') {
          setSessionId(msg.sessionId);
          const url = `${window.location.origin}/?session=${msg.sessionId}`;
          setPairingUrl(url);
          setState('waiting_for_phone');
        } else if (msg.type === 'camera_joined') {
          setState('phone_connected');
          if (!pcRef.current) pcRef.current = createPeerConnection();
        } else if (msg.type === 'signal') {
          const payload = msg.payload;
          if (!pcRef.current) pcRef.current = createPeerConnection();

          try {
            if (payload.type === 'offer') {
              await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload));
              const answer = await pcRef.current.createAnswer();
              await pcRef.current.setLocalDescription(answer);
              sig.send({ type: 'signal', payload: pcRef.current.localDescription });
            } else if (payload.type === 'candidate') {
              await pcRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate));
            }
          } catch (e) {
            console.error('Error handling signal', e);
          }
        } else if (msg.type === 'camera_left') {
          setState('disconnected');
          if (videoRef.current) videoRef.current.srcObject = null;
          if (pcRef.current) {
            pcRef.current.close();
            pcRef.current = null;
          }
        } else if (msg.type === 'error') {
          setState('error');
          setErrorMsg(msg.message);
        }
      },
      () => {
        sig.send({ type: 'create_session' });
      },
      () => {
        setState('disconnected');
      }
    );

    sig.connect();
    signalingRef.current = sig;
  };

  const startSession = () => {
    setState('idle');
    setSessionId(null);
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setupSignaling();
  };

  const endSession = () => {
    if (signalingRef.current) {
      signalingRef.current.send({ type: 'end_session' });
      signalingRef.current.disconnect();
      signalingRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setState('idle');
    setSessionId(null);
  };

  useEffect(() => {
    startSession();
    return () => {
      endSession();
      if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
    };
  }, []);

  useEffect(() => {
    if (state === 'streaming') {
      statsIntervalRef.current = window.setInterval(async () => {
        if (pcRef.current) {
          const stats = await pcRef.current.getStats();
          stats.forEach(report => {
            if (report.type === 'inbound-rtp' && report.kind === 'video') {
              if (report.frameWidth && report.frameHeight) {
                setResolution(`${report.frameWidth}x${report.frameHeight}`);
              }
              if (report.framesPerSecond) {
                setFps(Math.round(report.framesPerSecond));
              }
            }
          });
        }
      }, 2000);
    } else {
      if (statsIntervalRef.current) {
        clearInterval(statsIntervalRef.current);
        statsIntervalRef.current = null;
      }
      setResolution('');
      setFps(0);
    }
  }, [state]);

  const copyUrl = () => {
    navigator.clipboard.writeText(pairingUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  return (
    <div className="min-h-screen bg-bg-main flex flex-col font-sans">
      {/* Navbar */}
      <header className="h-16 border-b border-border flex items-center justify-between px-6 bg-bg-secondary shrink-0">
        <div className="flex items-center gap-3">
          <Camera className="w-6 h-6 text-brand" />
          <h1 className="text-text-primary font-medium tracking-wide">Luma Monitor</h1>
          <span className="text-xs font-mono text-text-secondary bg-border px-2 py-0.5 rounded-full ml-2">v1.0</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <div className={clsx("w-2 h-2 rounded-full", {
              'bg-brand': state === 'streaming',
              'bg-yellow-500': state === 'waiting_for_phone' || state === 'phone_connected',
              'bg-gray-500': state === 'idle' || state === 'disconnected',
              'bg-error': state === 'error'
            })}></div>
            <span className="capitalize">{state.replace(/_/g, ' ')}</span>
          </div>
          <button className="text-text-secondary hover:text-text-primary transition-colors p-1">
            <Settings className="w-5 h-5" />
          </button>
          <button className="text-text-secondary hover:text-text-primary transition-colors p-1">
            <HelpCircle className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden p-6 gap-6">
        
        {/* Left Column: Video Preview */}
        <div 
          ref={containerRef}
          className="flex-1 bg-bg-secondary rounded-lg border border-border overflow-hidden relative flex flex-col justify-center items-center shadow-lg"
        >
          {state === 'streaming' ? (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className={clsx("w-full h-full bg-black", {
                  'object-contain': fitMode === 'contain',
                  'object-cover': fitMode === 'cover'
                })}
              />
              <div className="absolute top-4 left-4 flex items-center gap-2">
                <div className="bg-red-500/90 text-white text-xs font-bold px-2 py-1 rounded shadow flex items-center gap-1">
                  <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></div>
                  LIVE
                </div>
              </div>
              
              {/* Overlay Toolbar */}
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-bg-panel/90 backdrop-blur border border-border p-2 rounded-lg opacity-0 hover:opacity-100 transition-opacity">
                <button 
                  onClick={() => setFitMode(f => f === 'contain' ? 'cover' : 'contain')}
                  className="p-2 text-text-secondary hover:text-white rounded hover:bg-border transition-colors"
                  title="Toggle Fit/Fill"
                >
                  <Monitor className="w-5 h-5" />
                </button>
                <button 
                  onClick={toggleFullscreen}
                  className="p-2 text-text-secondary hover:text-white rounded hover:bg-border transition-colors"
                  title="Toggle Fullscreen"
                >
                  {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
                </button>
              </div>
            </>
          ) : (
            <div className="text-center p-8">
              <div className="w-16 h-16 bg-bg-panel rounded-full flex items-center justify-center mx-auto mb-4 border border-border">
                <Camera className="w-8 h-8 text-text-secondary" />
              </div>
              <h2 className="text-xl text-text-primary mb-2">No camera connected</h2>
              <p className="text-text-secondary mb-6 max-w-sm mx-auto">
                {state === 'error' ? errorMsg : "Pair your Android phone to start a live preview."}
              </p>
              {(state === 'idle' || state === 'disconnected' || state === 'error') && (
                <button 
                  onClick={startSession}
                  className="bg-brand hover:bg-brand-hover text-bg-main font-medium px-4 py-2 rounded transition-colors"
                >
                  Connect phone
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Pairing Panel */}
        <div className="w-full lg:w-80 flex flex-col gap-4">
          <div className="bg-bg-secondary border border-border rounded-lg p-6 flex flex-col shadow-sm">
            <h3 className="text-lg font-medium text-text-primary mb-4 flex items-center gap-2">
              Connect your phone
            </h3>
            
            {state === 'waiting_for_phone' || state === 'phone_connected' || state === 'streaming' ? (
              <div className="flex flex-col items-center">
                <div className="bg-white p-4 rounded-xl mb-4 shadow-sm w-full flex justify-center">
                  <QRCodeSVG 
                    value={pairingUrl} 
                    size={200}
                    bgColor="#ffffff"
                    fgColor="#000000"
                    level="Q"
                  />
                </div>
                
                <p className="text-sm text-text-secondary text-center mb-4 leading-relaxed">
                  Scan the QR code with your Android phone, then allow camera access.
                </p>

                <div className="w-full flex items-center gap-2 bg-bg-panel border border-border rounded p-1 mb-4">
                  <input 
                    type="text" 
                    readOnly 
                    value={pairingUrl} 
                    className="bg-transparent text-text-secondary text-xs w-full px-2 outline-none font-mono"
                  />
                  <button 
                    onClick={copyUrl}
                    className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-border rounded transition-colors shrink-0"
                    title="Copy link"
                  >
                    {copied ? <Check className="w-4 h-4 text-brand" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                
                <div className="flex items-center gap-3 w-full">
                  <button 
                    onClick={startSession}
                    className="flex-1 flex items-center justify-center gap-2 bg-bg-panel hover:bg-border text-text-primary text-sm py-2 rounded transition-colors border border-border"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Regenerate
                  </button>
                  <button 
                    onClick={endSession}
                    className="flex-1 flex items-center justify-center gap-2 bg-error/10 hover:bg-error/20 text-error text-sm py-2 rounded transition-colors border border-error/20"
                  >
                    <X className="w-4 h-4" />
                    End Session
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center text-text-secondary py-8">
                <p className="text-sm">No active pairing session.</p>
                <button 
                  onClick={startSession}
                  className="mt-4 text-brand hover:text-brand-hover text-sm font-medium"
                >
                  Create new session
                </button>
              </div>
            )}
          </div>
          
          {/* Status Info */}
          {sessionId && (
            <div className="bg-bg-secondary border border-border rounded-lg p-4 flex flex-col gap-2 text-sm shadow-sm">
              <div className="flex justify-between">
                <span className="text-text-secondary">Session ID</span>
                <span className="text-text-primary font-mono bg-bg-panel px-1.5 rounded border border-border">{sessionId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Status</span>
                <span className="text-text-primary capitalize">{state.replace(/_/g, ' ')}</span>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Bottom Status Bar */}
      <footer className="h-10 border-t border-border bg-bg-secondary flex items-center justify-between px-6 text-xs text-text-secondary shrink-0">
        <div className="flex items-center gap-4">
          <span>Local Wi-Fi Connection</span>
          {resolution && (
            <>
              <span className="w-px h-3 bg-border"></span>
              <span>{resolution}</span>
            </>
          )}
          {fps > 0 && (
            <>
              <span className="w-px h-3 bg-border"></span>
              <span>{fps} FPS</span>
            </>
          )}
        </div>
        <div>
          Luma Monitor Workspace
        </div>
      </footer>
    </div>
  );
}
