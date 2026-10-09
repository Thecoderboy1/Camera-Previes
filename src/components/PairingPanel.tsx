import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Check, RefreshCw, X, Radio, Smartphone, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import { VideoState } from './VideoPreview';
import { TransportType } from '../lib/signaling';

interface PairingPanelProps {
  sessionId: string | null;
  pairingUrl: string;
  state: VideoState;
  transport: TransportType;
  onRegenerate: () => void;
  onEndSession: () => void;
}

export const PairingPanel: React.FC<PairingPanelProps> = ({
  sessionId,
  pairingUrl,
  state,
  transport,
  onRegenerate,
  onEndSession
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!pairingUrl) return;
    navigator.clipboard.writeText(pairingUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  const getStatusBadge = () => {
    switch (state) {
      case 'streaming':
        return { label: 'Streaming', color: 'bg-[#A3E635] text-[#0B0C0F]', dot: 'bg-[#0B0C0F]' };
      case 'phone_connected':
      case 'connecting':
        return { label: 'Phone connected', color: 'bg-blue-500/10 text-blue-400 border border-blue-500/20', dot: 'bg-blue-400' };
      case 'requesting_camera':
        return { label: 'Camera permission required', color: 'bg-amber-500/10 text-amber-400 border border-amber-500/20', dot: 'bg-amber-400' };
      case 'waiting_for_phone':
      case 'session_created':
        return { label: 'Waiting for phone', color: 'bg-amber-500/10 text-amber-400 border border-amber-500/20', dot: 'bg-amber-400' };
      case 'reconnecting':
        return { label: 'Connection interrupted', color: 'bg-orange-500/10 text-orange-400 border border-orange-500/20', dot: 'bg-orange-400' };
      case 'error':
        return { label: 'Error', color: 'bg-[#F87171]/10 text-[#F87171] border border-[#F87171]/20', dot: 'bg-[#F87171]' };
      case 'disconnected':
      case 'idle':
      default:
        return { label: 'Disconnected', color: 'bg-[#292C34] text-[#969BA7]', dot: 'bg-[#969BA7]' };
    }
  };

  const statusBadge = getStatusBadge();

  return (
    <div className="bg-[#111318] border border-[#292C34] rounded-xl p-5 flex flex-col shadow-lg w-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-[#F4F5F7] tracking-tight flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-[#A3E635]" />
          Connect your phone
        </h3>
        {sessionId && (
          <span className="text-xs font-mono text-[#969BA7] bg-[#17191F] border border-[#292C34] px-2 py-0.5 rounded">
            ID: {sessionId}
          </span>
        )}
      </div>

      {sessionId && pairingUrl ? (
        <div className="flex flex-col items-center">
          {/* QR Code Container */}
          <div className="bg-white p-3.5 rounded-xl border border-white/10 shadow-inner mb-4 w-[210px] h-[210px] flex items-center justify-center">
            <QRCodeSVG
              value={pairingUrl}
              size={180}
              bgColor="#ffffff"
              fgColor="#0B0C0F"
              level="M"
              includeMargin={false}
            />
          </div>

          <p className="text-xs text-[#969BA7] text-center mb-4 leading-relaxed max-w-[240px]">
            Scan the QR code with your Android phone, then allow camera access.
          </p>

          {/* Copyable Link Field */}
          <div className="w-full flex items-center gap-1.5 bg-[#17191F] border border-[#292C34] rounded-lg p-1.5 mb-4">
            <input
              type="text"
              readOnly
              value={pairingUrl}
              className="bg-transparent text-[#969BA7] text-xs font-mono w-full px-2 outline-none select-all truncate"
            />
            <button
              onClick={handleCopy}
              className="px-2.5 py-1.5 text-xs font-medium text-[#F4F5F7] bg-[#292C34] hover:bg-[#323640] rounded transition-colors flex items-center gap-1 shrink-0"
              title="Copy URL"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[#A3E635]" />
                  <span className="text-[#A3E635]">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>

          {/* Live Status Indicator */}
          <div className="w-full bg-[#17191F] border border-[#292C34] rounded-lg p-3 mb-4 flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#969BA7]">Pairing Status</span>
              <span className={clsx('px-2 py-0.5 rounded-full font-medium flex items-center gap-1.5', statusBadge.color)}>
                <span className={clsx('w-1.5 h-1.5 rounded-full', statusBadge.dot)} />
                {statusBadge.label}
              </span>
            </div>

            <div className="flex items-center justify-between text-xs pt-1 border-t border-[#292C34]/50">
              <span className="text-[#969BA7]">Signaling Channel</span>
              <span className="font-mono text-[#F4F5F7] flex items-center gap-1">
                <Radio className={clsx('w-3 h-3', transport === 'websocket' ? 'text-[#A3E635]' : 'text-blue-400')} />
                {transport.toUpperCase()}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="grid grid-cols-2 gap-2 w-full">
            <button
              onClick={onRegenerate}
              className="flex items-center justify-center gap-1.5 bg-[#17191F] hover:bg-[#292C34] text-[#F4F5F7] text-xs font-medium py-2 rounded-lg transition-colors border border-[#292C34]"
            >
              <RefreshCw className="w-3.5 h-3.5 text-[#969BA7]" />
              Regenerate
            </button>
            <button
              onClick={onEndSession}
              className="flex items-center justify-center gap-1.5 bg-[#F87171]/10 hover:bg-[#F87171]/20 text-[#F87171] text-xs font-medium py-2 rounded-lg transition-colors border border-[#F87171]/20"
            >
              <X className="w-3.5 h-3.5" />
              End Session
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <AlertTriangle className="w-8 h-8 text-[#969BA7] mb-3" />
          <p className="text-xs text-[#969BA7] mb-4">No active session.</p>
          <button
            onClick={onRegenerate}
            className="bg-[#A3E635] text-[#0B0C0F] text-xs font-medium px-4 py-2 rounded-lg hover:bg-[#84CC16] transition-colors"
          >
            Create Session
          </button>
        </div>
      )}
    </div>
  );
};
