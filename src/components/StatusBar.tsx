import React from 'react';
import { Wifi, Video, Zap, Activity } from 'lucide-react';
import { StreamStats } from '../lib/webrtc';
import { VideoState } from './VideoPreview';

interface StatusBarProps {
  state: VideoState;
  stats: StreamStats | null;
  connectionMethod?: string;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  state,
  stats,
  connectionMethod = 'Local Wi-Fi (WebRTC P2P)'
}) => {
  const isStreaming = state === 'streaming' && stats && stats.width > 0;

  return (
    <footer className="h-9 border-t border-[#292C34] bg-[#111318] flex items-center justify-between px-6 text-xs text-[#969BA7] select-none shrink-0">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5 text-[#F4F5F7]">
          <Wifi className="w-3.5 h-3.5 text-[#A3E635]" />
          <span>{connectionMethod}</span>
        </div>

        <span className="w-px h-3 bg-[#292C34]" />

        <div className="flex items-center gap-1.5 capitalize">
          <Activity className="w-3.5 h-3.5" />
          <span>Status: {state.replace(/_/g, ' ')}</span>
        </div>

        {isStreaming && (
          <>
            <span className="w-px h-3 bg-[#292C34]" />
            <div className="flex items-center gap-1.5 font-mono text-[#F4F5F7]">
              <Video className="w-3.5 h-3.5 text-[#969BA7]" />
              <span>{stats.width}x{stats.height}</span>
            </div>

            <span className="w-px h-3 bg-[#292C34]" />
            <div className="flex items-center gap-1.5 font-mono text-[#F4F5F7]">
              <Zap className="w-3.5 h-3.5 text-[#969BA7]" />
              <span>{stats.fps} FPS</span>
            </div>

            {stats.bitrateKbps !== undefined && stats.bitrateKbps > 0 && (
              <>
                <span className="w-px h-3 bg-[#292C34]" />
                <div className="flex items-center gap-1.5 font-mono text-[#969BA7]">
                  <span>{stats.bitrateKbps} kbps</span>
                </div>
              </>
            )}
          </>
        )}
      </div>

      <div className="text-[11px] text-[#969BA7]/70 font-mono">
        Luma Monitor Engine
      </div>
    </footer>
  );
};
