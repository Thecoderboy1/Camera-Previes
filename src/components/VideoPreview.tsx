import React, { useEffect, useRef, useState } from 'react';
import { Camera, Maximize, Minimize, Expand, Shrink, AlertCircle } from 'lucide-react';
import clsx from 'clsx';
import { StreamStats } from '../lib/webrtc';

export type VideoState =
  | 'idle'
  | 'session_created'
  | 'waiting_for_phone'
  | 'phone_connected'
  | 'requesting_camera'
  | 'connecting'
  | 'streaming'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

interface VideoPreviewProps {
  state: VideoState;
  remoteStream: MediaStream | null;
  stats: StreamStats | null;
  errorMessage?: string;
  onConnectClick?: () => void;
}

export const VideoPreview: React.FC<VideoPreviewProps> = ({
  state,
  remoteStream,
  stats,
  errorMessage,
  onConnectClick
}) => {
  const [fitMode, setFitMode] = useState<'contain' | 'cover'>('contain');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      if (remoteStream) {
        videoRef.current.srcObject = remoteStream;
      } else {
        videoRef.current.srcObject = null;
      }
    }
  }, [remoteStream]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const isStreaming = state === 'streaming' && !!remoteStream;

  return (
    <div
      ref={containerRef}
      className="relative flex-1 w-full bg-[#111318] rounded-xl border border-[#292C34] overflow-hidden flex flex-col justify-center items-center shadow-2xl group select-none"
    >
      {isStreaming ? (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={clsx(
              'w-full h-full bg-black transition-all duration-200',
              fitMode === 'contain' ? 'object-contain' : 'object-cover'
            )}
          />

          {/* Top-left Badges */}
          <div className="absolute top-4 left-4 flex items-center gap-2 pointer-events-none z-10">
            <div className="bg-[#17191F]/85 backdrop-blur-md border border-[#292C34] text-[#F4F5F7] text-xs font-semibold px-2.5 py-1 rounded-md flex items-center gap-1.5 shadow-md">
              <span className="w-2 h-2 rounded-full bg-[#A3E635] animate-pulse" />
              LIVE
            </div>

            {stats && stats.width > 0 && (
              <div className="bg-[#17191F]/85 backdrop-blur-md border border-[#292C34] text-[#969BA7] text-xs font-mono px-2 py-1 rounded-md shadow-md">
                {stats.width}x{stats.height} @ {stats.fps}fps
              </div>
            )}
          </div>

          {/* Overlay Toolbar on hover/tap */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center gap-1.5 bg-[#17191F]/90 backdrop-blur-md border border-[#292C34] p-1.5 rounded-lg shadow-xl z-20">
            <button
              onClick={() => setFitMode((m) => (m === 'contain' ? 'cover' : 'contain'))}
              className="p-2 text-[#969BA7] hover:text-[#F4F5F7] hover:bg-[#292C34] rounded transition-colors"
              title={fitMode === 'contain' ? 'Fill screen (Crop)' : 'Fit video (Letterbox)'}
            >
              {fitMode === 'contain' ? <Expand className="w-4 h-4" /> : <Shrink className="w-4 h-4" />}
            </button>
            <div className="w-px h-4 bg-[#292C34]" />
            <button
              onClick={toggleFullscreen}
              className="p-2 text-[#969BA7] hover:text-[#F4F5F7] hover:bg-[#292C34] rounded transition-colors"
              title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
            >
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
          </div>
        </>
      ) : (
        <div className="text-center p-8 max-w-md mx-auto flex flex-col items-center">
          <div className={clsx(
            'w-16 h-16 rounded-2xl flex items-center justify-center mb-5 border transition-colors',
            state === 'error'
              ? 'bg-[#F87171]/10 border-[#F87171]/20 text-[#F87171]'
              : 'bg-[#17191F] border-[#292C34] text-[#969BA7]'
          )}>
            {state === 'error' ? (
              <AlertCircle className="w-8 h-8 text-[#F87171]" />
            ) : (
              <Camera className="w-8 h-8" />
            )}
          </div>

          <h2 className="text-lg font-medium text-[#F4F5F7] mb-2 tracking-tight">
            {state === 'error'
              ? 'Connection notice'
              : state === 'waiting_for_phone'
              ? 'Waiting for Android phone'
              : state === 'phone_connected' || state === 'connecting'
              ? 'Connecting camera stream...'
              : 'No camera connected'}
          </h2>

          <p className="text-sm text-[#969BA7] mb-6 leading-relaxed">
            {state === 'error'
              ? (errorMessage || 'Connection was interrupted or session timed out.')
              : state === 'waiting_for_phone'
              ? 'Scan the QR code with your Android phone to start streaming.'
              : state === 'phone_connected' || state === 'connecting'
              ? 'Phone connected. Negotiating peer-to-peer video...'
              : 'Pair your Android phone to start a live preview.'}
          </p>

          {(state === 'idle' || state === 'disconnected' || state === 'error') && onConnectClick && (
            <button
              onClick={onConnectClick}
              className="bg-[#A3E635] hover:bg-[#84CC16] text-[#0B0C0F] text-sm font-medium px-5 py-2.5 rounded-lg transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-[#A3E635]/50"
            >
              Connect phone
            </button>
          )}

          {state === 'waiting_for_phone' && (
            <div className="flex items-center gap-2 text-xs text-[#969BA7] bg-[#17191F] border border-[#292C34] px-3 py-1.5 rounded-full">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              Listening for device pairing
            </div>
          )}
        </div>
      )}
    </div>
  );
};
