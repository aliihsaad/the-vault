import type { CSSProperties } from 'react';
import { Play, Sparkles, Square, VolumeX, X } from 'lucide-react';
import { useSparkControlViewModel } from '../../view-models/spark-control-view-model.js';
import { SparkSessionFrame } from './SparkSessionFrame.js';

/**
 * Persistent always-on-top overlay (roadmap D). Loaded by a separate frameless
 * BrowserWindow at the #spark-overlay route. It owns mic capture + playback +
 * controls (via the shared control view model) so a voice session keeps running
 * when the user navigates away from the main Spark page. Audio is routed here by
 * the host while the overlay is open, so there is no double playback.
 */
const DRAG: CSSProperties = { WebkitAppRegion: 'drag' } as CSSProperties;
const NO_DRAG: CSSProperties = { WebkitAppRegion: 'no-drag' } as CSSProperties;

export function SparkOverlay() {
  const vm = useSparkControlViewModel();

  return (
    <div className="spark-overlay">
      <header className="spark-overlay-header" style={DRAG}>
        <span className="spark-overlay-title">
          <Sparkles size={14} />
          <span>Spark</span>
        </span>
        <div className="spark-overlay-header-actions" style={NO_DRAG}>
          <span className={`spark-control-status-badge spark-session-status-badge ${vm.sessionStatusModel.className}`}>
            <span className="spark-control-status-dot" />
            {vm.sessionStatusModel.label}
          </span>
          <button
            type="button"
            className="header-button spark-overlay-close"
            onClick={() => void window.sparkOverlayApi?.close()}
            title="Close overlay"
            aria-label="Close overlay"
          >
            <X size={14} />
          </button>
        </div>
      </header>

      {vm.voiceError ? (
        <div className="note-card note-card-warning" role="alert"><p>{vm.voiceError}</p></div>
      ) : null}

      <div className="spark-overlay-controls" style={NO_DRAG}>
        <button
          type="button"
          className="primary-button"
          onClick={() => void (vm.sessionActive ? vm.stopVoiceSession() : vm.startVoiceSession())}
          disabled={vm.startSession.disabled}
          title={vm.startSession.tooltip}
        >
          {vm.sessionActive ? <Square size={14} /> : <Play size={14} />}
          <span>{vm.sessionActive ? 'Stop' : 'Start'}</span>
        </button>
        {vm.playback.playing ? (
          <button type="button" className="header-button" onClick={() => vm.stopPlayback()} title="Stop playback">
            <VolumeX size={14} />
            <span>Stop audio</span>
          </button>
        ) : null}
      </div>

      <div className="spark-overlay-body" style={NO_DRAG}>
        <SparkSessionFrame
          frame={vm.sessionFrame}
          panels={vm.sessionPanels}
          status={vm.sessionStatusModel.status}
          playback={vm.playback}
          onStopPlayback={vm.stopPlayback}
        />
      </div>
    </div>
  );
}
