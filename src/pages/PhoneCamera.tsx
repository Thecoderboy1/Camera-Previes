import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, SwitchCamera, Square, Shield, Radio, AlertTriangle, ArrowLeft } from 'lucide-react';
import { SignalingChannel, TransportType, isStaticHosting } from '../lib/signaling';
import { WebRTCManager } from '../lib/webrtc';
import clsx from 'clsx';

interface PhoneCameraProps {
  sessionId: string;
}

export default function PhoneCamera({ sessionId }: PhoneCameraProps) {
  const [streamState, setStreamState] = useState<'idle' | 'requesting' | 'streaming' | 'error'>('idle');
  const [transport, setTransport] = useState<TransportType>('disconnected');
  const [isViewerConnected, setIsViewerConnected] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [wakeLockActive, setWakeLockActive] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const signalingRef = useRef<SignalingChannel | null>(null);
  const rtcManagerRef = useRef<WebRTCManager | null>(null);
  const wakeLockRef = useRef<any>(null);

  // Request Screen Wake Lock so phone screen doesn't turn off while filming
  const requestWakeLock = useCallback(async () => {
    try {
      if ('wakeLock' in navigator && (navigator as any).wakeLock) {
        const lock = await (navigator as any).wakeLock.request('screen');
        wakeLockRef.current = lock;
        setWakeLockActive(true);
        lock.addEventListener('release', () => {
          setWakeLockActive(false);
        });
      }
    } catch {
      // Wake lock not supported or failed
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      try {
        wakeLockRef.current.release();
      } catch {}
      wakeLockRef.current = null;
    }
    setWakeLockActive(false);
  }, []);

  const stopStreaming = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (rtcManagerRef.current) {
      rtcManagerRef.current.close();
      rtcManagerRef.current = null;
    }
    releaseWakeLock();
    setStreamState('idle');
  }, [releaseWakeLock]);

  const initiatePeerConnection = useCallback(async (stream: MediaStream, sig: SignalingChannel) => {
    if (rtcManagerRef.current) {
      rtcManagerRef.current.close();
    }

    const rtc = new WebRTCManager({
      onIceCandidate: (candidate) => {
        sig.sendSignal({
          type: 'candidate',
          candidate
        });
      },
      onConnectionStateChange: (state) => {
        if (state === 'connected') {
          setIsViewerConnected(true);
        } else if (state === 'disconnected' || state === 'failed') {
          setIsViewerConnected(false);
        }
      }
    });

    rtc.initialize();
    rtc.addTracks(stream);
    rtcManagerRef.current = rtc;

    try {
      const offer = await rtc.createOffer();
      await sig.sendSignal(offer);
    } catch (e: any) {
      console.warn('Offer creation warning:', e?.message);
    }
  }, []);

  const startStreaming = useCallback(async (targetFacingMode = facingMode) => {
    try {
      setStreamState('requesting');
      setErrorMessage('');

      // Check Secure Context requirement
      if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        throw new Error('Camera access requires HTTPS or a secure context. Please open via HTTPS.');
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera API (getUserMedia) is unavailable in this browser context.');
      }

      // Stop old tracks before requesting new
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: targetFacingMode,
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
          frameRate: { ideal: 30, max: 60 }
        },
        audio: false
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      setStreamState('streaming');
      requestWakeLock();

      const sig = signalingRef.current;
      if (sig) {
        const peerEngine = sig.getPeerEngine();
        if (peerEngine) {
          // If already streaming via Cloud Peer, replace track
          const videoTrack = stream.getVideoTracks()[0];
          if (videoTrack) {
            peerEngine.replaceTrack(videoTrack);
          }
        } else if (isStaticHosting() || sig.getTransport() === 'cloud-peer') {
          await sig.connectCloudPeer(sessionId, stream);
        } else {
          // Local backend mode
          if (rtcManagerRef.current && rtcManagerRef.current.getConnectionState() === 'connected') {
            const videoTrack = stream.getVideoTracks()[0];
            if (videoTrack) {
              await rtcManagerRef.current.replaceVideoTrack(videoTrack);
            }
          } else {
            await initiatePeerConnection(stream, sig);
          }
        }
      }
    } catch (err: any) {
      setStreamState('error');
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setErrorMessage('Camera permission was denied. Tap the camera/lock icon in your browser address bar to allow access.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setErrorMessage('No camera found on this device.');
      } else {
        setErrorMessage(err.message || 'Could not start camera feed.');
      }
    }
  }, [facingMode, sessionId, initiatePeerConnection, requestWakeLock]);

  const switchCamera = useCallback(() => {
    const nextFacingMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextFacingMode);
    if (streamState === 'streaming') {
      startStreaming(nextFacingMode);
    }
  }, [facingMode, streamState, startStreaming]);

  // Signaling setup
  useEffect(() => {
    const savedMode = (localStorage.getItem('luma_signaling_mode') as any) || (isStaticHosting() ? 'cloud' : 'auto');
    const customUrl = localStorage.getItem('luma_backend_url') || '';

    const sig = new SignalingChannel(
      'camera',
      {
        onJoined: () => {
          setIsViewerConnected(true);
        },
        onViewerLeft: () => {
          setIsViewerConnected(false);
        },
        onSignal: async (payload) => {
          const rtc = rtcManagerRef.current;
          if (!rtc) return;

          try {
            if (payload.type === 'answer') {
              await rtc.handleAnswer(payload);
            } else if (payload.type === 'candidate' && payload.candidate) {
              await rtc.addIceCandidate(payload.candidate);
            }
          } catch (e: any) {
            console.warn('WebRTC signal handling warning:', e?.message);
          }
        },
        onSessionEnded: () => {
          stopStreaming();
          setErrorMessage('The Mac host ended the session.');
        },
        onTransportChange: (newTransport) => {
          setTransport(newTransport);
        },
        onError: (msg) => {
          setErrorMessage(msg);
        }
      },
      savedMode,
      customUrl
    );

    signalingRef.current = sig;

    // In local backend mode, connect immediately to notify viewer
    if (!isStaticHosting() && savedMode !== 'cloud') {
      sig.connect(sessionId);
    }

    // Handle tab visibility change
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && streamState === 'streaming') {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      stopStreaming();
      sig.disconnect();
    };
  }, [sessionId, stopStreaming, streamState, requestWakeLock]);

  return (
    <div className="fixed inset-0 bg-[#0B0C0F] text-[#F4F5F7] flex flex-col font-sans select-none overflow-hidden">
      {/* Mobile Top Navigation */}
      <header className="h-14 border-b border-[#292C34] bg-[#111318] px-4 flex items-center justify-between z-20 shrink-0">
        <div className="flex items-center gap-2.5">
          <a
            href="/"
            className="p-1 -ml-1 text-[#969BA7] hover:text-[#F4F5F7]"
            title="Back to Dashboard"
          >
            <ArrowLeft className="w-5 h-5" />
          </a>
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-[#A3E635]" />
            <span className="font-medium text-sm tracking-tight text-[#F4F5F7]">Luma Camera</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Viewer Connection State */}
          <div className="flex items-center gap-1.5 bg-[#17191F] border border-[#292C34] px-2.5 py-1 rounded-full text-[11px]">
            <span
              className={clsx(
                'w-1.5 h-1.5 rounded-full',
                isViewerConnected || streamState === 'streaming' ? 'bg-[#A3E635]' : 'bg-amber-400'
              )}
            />
            <span className="text-[#969BA7]">
              {isViewerConnected || streamState === 'streaming' ? 'Connected' : 'Ready to stream'}
            </span>
          </div>
        </div>
      </header>

      {/* Main Camera Area */}
      <main className="flex-1 relative bg-black flex flex-col justify-center items-center overflow-hidden">
        {/* Local Camera Video Feed */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={clsx(
            'absolute inset-0 w-full h-full object-cover transition-opacity duration-300',
            streamState === 'streaming' ? 'opacity-100' : 'opacity-0'
          )}
        />

        {/* Setup Card (Before Permission Granted or when idle/error) */}
        {streamState !== 'streaming' && (
          <div className="z-10 p-6 m-4 flex flex-col items-center text-center max-w-sm w-full bg-[#111318]/95 backdrop-blur-md rounded-2xl border border-[#292C34] shadow-2xl">
            <div
              className={clsx(
                'w-16 h-16 rounded-2xl flex items-center justify-center mb-4 border',
                streamState === 'error'
                  ? 'bg-[#F87171]/10 border-[#F87171]/20 text-[#F87171]'
                  : 'bg-[#17191F] border-[#292C34] text-[#A3E635]'
              )}
            >
              {streamState === 'error' ? (
                <AlertTriangle className="w-8 h-8" />
              ) : (
                <Shield className="w-8 h-8" />
              )}
            </div>

            <h1 className="text-lg font-medium text-[#F4F5F7] mb-2 tracking-tight">
              {streamState === 'error' ? 'Connection Notice' : 'Connect to your Mac'}
            </h1>

            {streamState === 'error' ? (
              <>
                <p className="text-xs text-[#F87171] mb-6 leading-relaxed">
                  {errorMessage}
                </p>
                <button
                  onClick={() => startStreaming(facingMode)}
                  className="w-full bg-[#A3E635] hover:bg-[#84CC16] text-[#0B0C0F] py-3 rounded-xl font-medium text-sm transition-colors shadow-sm"
                >
                  Try again
                </button>
              </>
            ) : (
              <>
                <p className="text-xs text-[#969BA7] mb-6 leading-relaxed">
                  Your phone will stream its live camera feed directly to your paired Mac over WebRTC.
                </p>

                <button
                  onClick={() => startStreaming(facingMode)}
                  disabled={streamState === 'requesting'}
                  className="w-full bg-[#A3E635] hover:bg-[#84CC16] text-[#0B0C0F] py-3.5 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-colors shadow-sm disabled:opacity-50 active:scale-[0.98]"
                >
                  <Camera className="w-4 h-4" />
                  {streamState === 'requesting' ? 'Starting Camera...' : 'Allow camera access'}
                </button>

                <p className="text-[11px] text-[#969BA7]/70 mt-4 leading-relaxed">
                  The browser will prompt for camera access. Video stream is encrypted end-to-end and never stored.
                </p>
              </>
            )}
          </div>
        )}

        {/* Live Controls Overlay (When Streaming) */}
        {streamState === 'streaming' && (
          <div className="absolute inset-x-0 bottom-0 p-6 flex items-end justify-between z-20 bg-gradient-to-t from-black/80 via-black/40 to-transparent pointer-events-none">
            {/* Live Indicator & Camera Lens Tag */}
            <div className="flex flex-col gap-1.5 pointer-events-auto">
              <div className="bg-[#17191F]/90 backdrop-blur-md border border-[#292C34] text-[#F4F5F7] text-xs font-semibold px-2.5 py-1 rounded-md flex items-center gap-1.5 shadow-lg">
                <span className="w-2 h-2 rounded-full bg-[#A3E635] animate-pulse" />
                TRANSMITTING
              </div>

              <div className="text-[11px] font-mono text-[#969BA7] bg-black/60 px-2 py-0.5 rounded backdrop-blur">
                {facingMode === 'user' ? 'Front Camera' : 'Rear Camera'}
              </div>
            </div>

            {/* Actions: Flip Camera & Stop Stream */}
            <div className="flex items-center gap-3 pointer-events-auto">
              <button
                onClick={switchCamera}
                className="w-12 h-12 bg-[#17191F]/90 backdrop-blur-md hover:bg-[#292C34] text-[#F4F5F7] rounded-full flex items-center justify-center border border-[#292C34] shadow-xl transition-all active:scale-95"
                title="Switch Front / Rear Camera"
              >
                <SwitchCamera className="w-5 h-5 text-[#A3E635]" />
              </button>

              <button
                onClick={stopStreaming}
                className="w-12 h-12 bg-[#F87171] hover:bg-[#EF4444] text-[#0B0C0F] rounded-full flex items-center justify-center shadow-xl transition-all active:scale-95"
                title="Stop Streaming"
              >
                <Square className="w-5 h-5 fill-current" />
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Mobile Footer Status */}
      <footer className="h-7 border-t border-[#292C34] bg-[#111318] px-4 flex items-center justify-between text-[11px] text-[#969BA7] shrink-0">
        <div className="flex items-center gap-1.5">
          <Radio className={clsx('w-3 h-3', transport === 'cloud-peer' || transport === 'websocket' ? 'text-[#A3E635]' : 'text-blue-400')} />
          <span>{transport === 'cloud-peer' ? 'CLOUD WEBRTC' : transport.toUpperCase()}</span>
        </div>
        <div>
          {wakeLockActive ? 'Screen Awake' : 'Standby'}
        </div>
      </footer>
    </div>
  );
}
