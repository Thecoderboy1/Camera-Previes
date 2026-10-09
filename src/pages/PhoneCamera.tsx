import React, { useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw, X, Shield, Activity, RotateCcw } from 'lucide-react';
import { SignalingChannel } from '../lib/signaling';
import clsx from 'clsx';

interface PhoneCameraProps {
  sessionId: string;
}

type StreamState = 'idle' | 'requesting' | 'streaming' | 'error';
type WSState = 'connecting' | 'connected' | 'disconnected' | 'error';

export default function PhoneCamera({ sessionId }: PhoneCameraProps) {
  const [streamState, setStreamState] = useState<StreamState>('idle');
  const [wsState, setWsState] = useState<WSState>('connecting');
  const [errorMsg, setErrorMsg] = useState('');
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const signalingRef = useRef<SignalingChannel | null>(null);

  const getWsUrl = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  };

  const setupSignaling = () => {
    const sig = new SignalingChannel(
      getWsUrl(),
      async (msg) => {
        if (msg.type === 'joined') {
          setWsState('connected');
        } else if (msg.type === 'error') {
          setWsState('error');
          setErrorMsg(msg.message);
        } else if (msg.type === 'signal') {
          const payload = msg.payload;
          if (!pcRef.current) return;
          
          try {
            if (payload.type === 'answer') {
              await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload));
            } else if (payload.type === 'candidate') {
              await pcRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate));
            }
          } catch (e) {
            console.error('Signal handling error', e);
          }
        } else if (msg.type === 'session_ended' || msg.type === 'viewer_left') {
          stopStreaming();
          setWsState('disconnected');
          setErrorMsg('Desktop disconnected.');
        }
      },
      () => {
        sig.send({ type: 'join_session', role: 'camera', sessionId });
      },
      () => {
        setWsState('disconnected');
        stopStreaming();
      }
    );
    sig.connect();
    signalingRef.current = sig;
  };

  useEffect(() => {
    setupSignaling();
    return () => {
      stopStreaming();
      if (signalingRef.current) {
        signalingRef.current.disconnect();
      }
    };
  }, [sessionId]);

  const stopStreaming = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    setStreamState('idle');
  };

  const startStreaming = async (mode = facingMode) => {
    try {
      setStreamState('requesting');
      
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera API not available. Ensure you are using HTTPS and your browser supports it.');
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: mode,
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
      
      // Stop old local tracks if any
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      
      setStreamState('streaming');

      const videoTrack = stream.getVideoTracks()[0];

      // Set up or update WebRTC connection
      if (!pcRef.current) {
        const pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        pcRef.current = pc;

        pc.addTrack(videoTrack, stream);

        pc.onicecandidate = (event) => {
          if (event.candidate && signalingRef.current) {
            signalingRef.current.send({
              type: 'signal',
              payload: { type: 'candidate', candidate: event.candidate }
            });
          }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        if (signalingRef.current) {
          signalingRef.current.send({
            type: 'signal',
            payload: pc.localDescription
          });
        }
      } else {
        // Reuse existing PC, replace track
        const sender = pcRef.current.getSenders().find(s => s.track?.kind === 'video');
        if (sender && videoTrack) {
          await sender.replaceTrack(videoTrack);
        }
      }
      
    } catch (err: any) {
      console.error('Camera access error:', err);
      setStreamState('error');
      setErrorMsg(err.message || 'Could not access camera. Ensure you are using HTTPS and granted permission.');
    }
  };

  const switchCamera = () => {
    const nextMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextMode);
    if (streamState === 'streaming') {
      startStreaming(nextMode);
    }
  };

  return (
    <div className="min-h-screen bg-bg-main text-text-primary flex flex-col font-sans">
      <header className="h-14 flex items-center justify-between px-4 bg-bg-secondary border-b border-border z-10 shrink-0">
        <div className="flex items-center gap-2">
          <Camera className="w-5 h-5 text-brand" />
          <span className="font-medium">Luma Monitor</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <div className={clsx("w-2 h-2 rounded-full", {
            'bg-brand': wsState === 'connected',
            'bg-yellow-500': wsState === 'connecting',
            'bg-error': wsState === 'error' || wsState === 'disconnected'
          })}></div>
          <span className="capitalize">{wsState}</span>
        </div>
      </header>

      <main className="flex-1 relative bg-black flex flex-col justify-center items-center overflow-hidden">
        {/* Video Element */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={clsx("absolute inset-0 w-full h-full object-cover transition-opacity duration-300", {
            'opacity-100': streamState === 'streaming',
            'opacity-0': streamState !== 'streaming'
          })}
        />

        {/* UI Overlay */}
        {streamState !== 'streaming' && (
          <div className="z-10 p-6 flex flex-col items-center text-center max-w-sm w-full bg-bg-secondary/90 backdrop-blur rounded-2xl border border-border">
            <div className="w-16 h-16 bg-bg-panel rounded-full flex items-center justify-center mb-4 border border-border">
              <Shield className="w-8 h-8 text-brand" />
            </div>
            <h1 className="text-xl font-medium mb-2">Connect to your Mac</h1>
            
            {streamState === 'error' || wsState === 'error' ? (
              <>
                <p className="text-error mb-6 text-sm">{errorMsg}</p>
                <button 
                  onClick={() => window.location.reload()}
                  className="w-full bg-bg-panel border border-border text-text-primary py-3 rounded-lg font-medium flex justify-center items-center gap-2 mb-4 hover:bg-border transition-colors"
                >
                  <RefreshCw className="w-4 h-4" /> Try Again
                </button>
              </>
            ) : wsState !== 'connected' ? (
              <p className="text-text-secondary text-sm mb-6">Connecting to pairing session...</p>
            ) : (
              <>
                <p className="text-text-secondary text-sm mb-6">
                  Allow camera access to start streaming securely to your paired computer.
                </p>
                <button 
                  onClick={() => startStreaming(facingMode)}
                  disabled={streamState === 'requesting'}
                  className="w-full bg-brand text-bg-main py-3 rounded-lg font-medium flex justify-center items-center gap-2 mb-4 hover:bg-brand-hover transition-colors disabled:opacity-50"
                >
                  {streamState === 'requesting' ? (
                    <><RefreshCw className="w-4 h-4 animate-spin" /> Requesting...</>
                  ) : (
                    <><Camera className="w-4 h-4" /> Allow camera access</>
                  )}
                </button>
                <p className="text-[10px] text-text-secondary max-w-[250px]">
                  Your browser will request permission. Video is streamed locally and never recorded.
                </p>
              </>
            )}
          </div>
        )}

        {/* Controls Overlay when streaming */}
        {streamState === 'streaming' && (
          <div className="absolute bottom-8 left-0 w-full px-6 flex justify-between items-end z-10">
            <div className="flex flex-col gap-1 text-xs text-white/80 bg-black/40 backdrop-blur px-2 py-1.5 rounded border border-white/10">
              <span className="flex items-center gap-1.5 font-mono">
                <Activity className="w-3 h-3 text-brand" /> LIVE
              </span>
            </div>
            
            <div className="flex items-center gap-4">
              <button 
                onClick={switchCamera}
                className="w-12 h-12 bg-bg-secondary/80 backdrop-blur rounded-full flex items-center justify-center text-white border border-white/10 hover:bg-white/20 transition-colors"
              >
                <RotateCcw className="w-6 h-6" />
              </button>
              
              <button 
                onClick={stopStreaming}
                className="w-12 h-12 bg-error/90 rounded-full flex items-center justify-center text-white shadow-lg hover:bg-error transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
