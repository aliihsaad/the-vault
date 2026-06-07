import {
  BrainCircuit,
  CheckCircle2,
  Circle,
  Headphones,
  Keyboard,
  Mic,
  Radio,
  Play,
  RefreshCw,
  Send,
  Sparkles,
  Square,
} from 'lucide-react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useSparkControlViewModel } from '../../view-models/spark-control-view-model.js';
import type { SparkVoiceSessionMode } from '../../view-models/spark-control-view-model.js';
import { SparkSessionFrame } from './SparkSessionFrame.js';

/**
 * Spark Control Page (S1). An honest, dedicated control surface for the Spark
 * voice assistant: live status, capability counts, a readiness checklist, the
 * INERT session frame, an installed-skills list, and a read-only Brain artifact
 * viewer. No audio, no provider keys, no fake "live" affordances — the
 * "Start session" button stays disabled until S3 wires the voice runtime.
 */
export function SparkControlPage() {
  const {
    loading,
    error,
    actionError,
    pendingAction,
    actionPendingSkillId,
    actionPendingArtifactName,
    statusModel,
    capabilities,
    readiness,
    startSession,
    sessionPanels,
    sessionFrame,
    sessionStatusModel,
    sessionActive,
    sessionMode,
    textMessage,
    voiceError,
    playback,
    skills,
    brain,
    refresh,
    startVoiceSession,
    stopVoiceSession,
    sendTextMessage,
    startPushToTalk,
    stopPushToTalk,
    setSessionMode,
    setTextMessage,
    stopPlayback,
    toggleSkill,
    viewArtifact,
  } = useSparkControlViewModel();

  // Roving-focus arrow-key navigation for the conversation-mode radiogroup so it
  // behaves like a real radio group for keyboard and screen-reader users.
  const MODES: SparkVoiceSessionMode[] = ['push-to-talk', 'always-listening', 'text-only'];
  function onModeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    if (!forward && !backward) {
      return;
    }
    event.preventDefault();
    const current = MODES.indexOf(sessionMode);
    const next = forward
      ? MODES[(current + 1) % MODES.length]
      : MODES[(current - 1 + MODES.length) % MODES.length];
    setSessionMode(next);
  }

  return (
    <section className="panel spark-control-page" aria-labelledby="spark-control-title" aria-busy={loading}>
      <header className="spark-control-header">
        <div className="spark-control-heading">
          <span className="spark-control-mark"><Sparkles size={20} /></span>
          <div>
            <h2 id="spark-control-title">Spark</h2>
            <p>Voice runtime and brain — the most capable Vault extension.</p>
          </div>
        </div>
        <div className="spark-control-header-actions">
          <span className={`spark-control-status-badge ${statusModel.className}`}>
            <span className="spark-control-status-dot" />
            {loading ? 'Loading' : statusModel.label}
          </span>
          <button type="button" className="header-button" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw size={16} />
            <span>{loading ? 'Loading...' : 'Refresh'}</span>
          </button>
          <button
            type="button"
            className="primary-button spark-control-start"
            onClick={() => void (sessionActive ? stopVoiceSession() : startVoiceSession())}
            disabled={startSession.disabled}
            title={startSession.tooltip}
            aria-disabled={startSession.disabled}
          >
            {sessionActive ? <Square size={16} /> : <Play size={16} />}
            <span>{startSession.label}</span>
          </button>
        </div>
      </header>

      <p className="spark-control-status-detail">{loading ? 'Reading the Spark extension snapshot.' : statusModel.detail}</p>

      {error ? (
        <div className="note-card note-card-warning" role="alert"><p>{error}</p></div>
      ) : null}
      {actionError ? (
        <div className="note-card note-card-warning" role="alert"><p>{actionError}</p></div>
      ) : null}
      {voiceError ? (
        <div className="note-card note-card-warning" role="alert"><p>{voiceError}</p></div>
      ) : null}

      <div className="spark-control-capabilities" aria-label="Spark capabilities">
        {capabilities.map((capability) => (
          <div key={capability.key} className="spark-control-capability">
            <strong>{capability.value}</strong>
            <span>{capability.label}</span>
          </div>
        ))}
      </div>

      <section className="snippet-card spark-control-readiness" aria-labelledby="spark-control-readiness-title">
        <div className="snippet-head">
          <div>
            <div className="field-label" id="spark-control-readiness-title">Readiness checklist</div>
            <div className="field-help">Honest status — items turn green only when actually wired.</div>
          </div>
        </div>
        <ul className="spark-control-readiness-list">
          {readiness.map((item) => (
            <li
              key={item.key}
              className={`spark-control-readiness-item ${item.ready ? 'spark-control-readiness-ready' : 'spark-control-readiness-pending'}`}
            >
              {item.ready ? <CheckCircle2 size={16} /> : <Circle size={16} />}
              <div>
                <strong>{item.label}</strong>
                <span>{item.detail}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="spark-control-session" aria-labelledby="spark-control-session-title">
        <div className="spark-control-section-head">
          <Mic size={16} />
          <div>
            <div className="field-label" id="spark-control-session-title">Live session</div>
            <div className="field-help">Bound to the live S3 voice stream.</div>
          </div>
          <span className={`spark-control-status-badge spark-session-status-badge ${sessionStatusModel.className}`}>
            <span className="spark-control-status-dot" />
            {sessionStatusModel.label}
          </span>
        </div>
        <div className="spark-session-controls" aria-label="Spark session controls">
          <div
            className="spark-session-mode-group"
            role="radiogroup"
            aria-label="Conversation mode"
            onKeyDown={onModeKeyDown}
          >
            <button
              type="button"
              className={`spark-session-mode ${sessionMode === 'push-to-talk' ? 'spark-session-mode-active' : ''}`}
              onClick={() => setSessionMode('push-to-talk')}
              role="radio"
              aria-checked={sessionMode === 'push-to-talk'}
              tabIndex={sessionMode === 'push-to-talk' ? 0 : -1}
            >
              <Mic size={14} />
              <span>Push to talk</span>
            </button>
            <button
              type="button"
              className={`spark-session-mode ${sessionMode === 'always-listening' ? 'spark-session-mode-active' : ''}`}
              onClick={() => setSessionMode('always-listening')}
              role="radio"
              aria-checked={sessionMode === 'always-listening'}
              tabIndex={sessionMode === 'always-listening' ? 0 : -1}
            >
              <Radio size={14} />
              <span>Always listening</span>
            </button>
            <button
              type="button"
              className={`spark-session-mode ${sessionMode === 'text-only' ? 'spark-session-mode-active' : ''}`}
              onClick={() => setSessionMode('text-only')}
              role="radio"
              aria-checked={sessionMode === 'text-only'}
              tabIndex={sessionMode === 'text-only' ? 0 : -1}
            >
              <Keyboard size={14} />
              <span>Text only</span>
            </button>
          </div>
          <button
            type="button"
            className="header-button spark-session-talk"
            disabled={!sessionActive || sessionMode !== 'push-to-talk'}
            onMouseDown={() => void startPushToTalk()}
            onMouseUp={() => stopPushToTalk()}
            onMouseLeave={() => stopPushToTalk()}
            title="Hold while speaking"
          >
            <Headphones size={14} />
            <span>Hold to speak</span>
          </button>
          <form className="spark-session-text-form" onSubmit={(event) => {
            event.preventDefault();
            void sendTextMessage();
          }}>
            <input
              type="text"
              value={textMessage}
              onChange={(event) => setTextMessage(event.currentTarget.value)}
              placeholder="Type to Spark"
              disabled={!sessionActive}
              aria-label="Text message to Spark"
            />
            <button
              type="submit"
              className="header-button"
              disabled={!sessionActive || textMessage.trim().length === 0}
            >
              <Send size={14} />
              <span>Send</span>
            </button>
          </form>
        </div>
        <SparkSessionFrame
          frame={sessionFrame}
          panels={sessionPanels}
          status={sessionStatusModel.status}
          playback={playback}
          onStopPlayback={stopPlayback}
        />
      </section>

      <section className="snippet-card spark-control-skills" aria-labelledby="spark-control-skills-title">
        <div className="snippet-head">
          <div>
            <div className="field-label" id="spark-control-skills-title">Skills &amp; tools</div>
            <div className="field-help">{skills.summaryLabel}</div>
          </div>
        </div>
        {skills.installedRows.length === 0 ? (
          <p className="spark-session-empty">{skills.installedEmptyLabel}</p>
        ) : (
          <ul className="spark-control-skill-list" aria-label="Installed Spark skills">
            {skills.installedRows.map((skill) => (
              <li key={skill.skillId} className="spark-control-skill-row">
                <div className="spark-control-skill-copy">
                  <strong>{skill.name}</strong>
                  <span>{skill.namespace} · {skill.executionLabel} · {skill.supportedToolsSummary}</span>
                </div>
                <div className="spark-control-skill-actions">
                  <span className={`spark-skill-state ${skill.stateClassName}`}>{skill.stateLabel}</span>
                  <button
                    type="button"
                    className="header-button"
                    onClick={() => void toggleSkill(skill.skillId)}
                    disabled={skill.toggleDisabled || (pendingAction === 'toggle-skill' && actionPendingSkillId === skill.skillId)}
                    title={skill.lockedReasonLabel ?? skill.toggleLabel}
                  >
                    {pendingAction === 'toggle-skill' && actionPendingSkillId === skill.skillId
                      ? 'Updating...'
                      : skill.toggleLabel}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="snippet-card spark-control-brain" aria-labelledby="spark-control-brain-title">
        <div className="snippet-head">
          <div>
            <div className="field-label" id="spark-control-brain-title">Brain artifacts</div>
            <div className="field-help">{brain.summaryLabel}</div>
          </div>
          <BrainCircuit size={16} />
        </div>
        <ul className="spark-control-artifact-list" aria-label="Spark Brain artifacts (read-only)">
          {brain.rows.map((artifact) => (
            <li key={artifact.artifactName} className="spark-control-artifact-row">
              <button
                type="button"
                className="spark-control-artifact-button"
                onClick={() => void viewArtifact(artifact.artifactName)}
                disabled={pendingAction === 'view-artifact' && actionPendingArtifactName === artifact.artifactName}
                title={`View ${artifact.displayName}`}
              >
                <span className="spark-control-artifact-name">{artifact.displayName}</span>
                <span className={`spark-brain-freshness ${artifact.freshnessClassName}`}>{artifact.freshnessLabel}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
