import type { VaultCollabSnapshotRiskLevel } from '@the-vault/core';

import type { VaultCollabRosterAgent, VaultCollabSessionHudModel } from '../../vault-collab-view-model.js';
import claudeIconUrl from '../../../../../assets/claude-color.svg';
import codexIconUrl from '../../../../../assets/codex-color.svg';
import geminiIconUrl from '../../../../../assets/gemini-color.svg';
import opencodeIconUrl from '../../../../../assets/opencode-dark.svg';

interface SessionHudCardProps {
  agent: VaultCollabRosterAgent;
  onSelectHandoff: (handoffUid: string) => void;
}

export function SessionHudCard({ agent, onSelectHandoff }: SessionHudCardProps) {
  if (!agent.hud.hasSnapshot) {
    return <LegacySessionRow agent={agent} />;
  }

  const inactiveClass = agent.status === 'complete' || agent.status === 'disconnected'
    ? 'vault-collab-session-hud-inactive'
    : '';

  return (
    <div className={`vault-collab-agent-row vault-collab-session-hud ${inactiveClass}`}>
      <span className="vault-collab-client-dot">
        <AgentClientIcon agent={agent} />
      </span>
      <div className="vault-collab-roster-main vault-collab-session-hud-main">
        <div className="vault-collab-session-hud-header">
          <div className="vault-collab-row-title">
            <strong>{agent.displayName}</strong>
            <SessionAdapterChip adapter={agent.hud.adapter} />
          </div>
          <SyncIndicator sync={agent.hud.sync} />
        </div>
        <div className="vault-collab-row-meta">
          <span>{agent.roleLabel}</span>
          {agent.currentHandoffUid ? <span className="text-mono">{shortId(agent.currentHandoffUid)}</span> : <span>unassigned</span>}
          <span className={`vault-collab-connection-pill ${agent.freshness === 'fresh' ? 'vault-collab-connection-fresh' : 'vault-collab-connection-stale'}`}>
            {agent.freshness}
          </span>
        </div>
        <SessionStatusPair
          lifecycle={agent.hud.lifecycleStatus}
          reportedState={agent.hud.reportedState}
        />
        <SessionContextBar context={agent.hud.context} />
        <div className="vault-collab-session-hud-secondary">
          <SessionProgressMeter progress={agent.hud.progress} />
          <div className="vault-collab-session-hud-badges">
            <SessionCostBadge cost={agent.hud.cost} />
            <SessionRiskBadge risk={agent.hud.risk} />
          </div>
        </div>
        <SnapshotHandoffList
          handoffs={agent.hud.activeHandoffs}
          onSelectHandoff={onSelectHandoff}
        />
        <ToolGrantList grants={agent.hud.toolGrants} />
      </div>
    </div>
  );
}

export function SessionAdapterChip({ adapter }: { adapter: VaultCollabSessionHudModel['adapter'] }) {
  return (
    <span
      className={`vault-collab-adapter-chip vault-collab-adapter-chip-${adapter.tone}`}
      title={adapter.title ?? undefined}
    >
      {adapter.label}
    </span>
  );
}

export function SessionStatusPair({
  lifecycle,
  reportedState,
}: {
  lifecycle: VaultCollabSessionHudModel['lifecycleStatus'];
  reportedState: VaultCollabSessionHudModel['reportedState'];
}) {
  return (
    <div className="vault-collab-status-pair">
      <span className={`badge ${lifecycle.badgeClass}`}>Lifecycle: {lifecycle.label}</span>
      <span className={`vault-collab-reported-status ${reportedState.badgeClass}`}>
        Agent reports: {reportedState.label}
      </span>
    </div>
  );
}

export function SessionContextBar({ context }: { context: VaultCollabSessionHudModel['context'] }) {
  return (
    <div className="vault-collab-context-bar">
      <span>{context.providerLabel}</span>
      <span>{context.modelLabel}</span>
      <TokenGauge gauge={context.tokenGauge} riskLevel={context.compactionRisk.level} />
      <span className={`vault-collab-risk-badge ${context.compactionRisk.className}`}>
        {context.compactionRisk.label}
      </span>
    </div>
  );
}

export function TokenGauge({
  gauge,
  riskLevel,
}: {
  gauge: VaultCollabSessionHudModel['context']['tokenGauge'];
  riskLevel: VaultCollabSnapshotRiskLevel;
}) {
  const ariaProps = gauge.percentUsed === null
    ? {}
    : { 'aria-valuenow': Math.round(gauge.percentUsed) };
  const ariaLabel = gauge.available && gauge.used !== null && gauge.remaining !== null
    ? `Token usage: ${formatNumber(gauge.used)} used, ${formatNumber(gauge.remaining)} remaining`
    : 'Token usage unavailable';

  return (
    <span className={`vault-collab-token-gauge vault-collab-token-gauge-${riskLevel}`}>
      <span
        className={`vault-collab-token-gauge-rail ${gauge.available ? '' : 'vault-collab-token-gauge-unavailable'}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={ariaLabel}
        {...ariaProps}
      >
        {gauge.percentUsed !== null ? (
          <span className="vault-collab-token-gauge-fill" style={{ width: `${gauge.percentUsed}%` }} />
        ) : null}
      </span>
      <span>{gauge.label}</span>
    </span>
  );
}

export function SessionProgressMeter({ progress }: { progress: VaultCollabSessionHudModel['progress'] }) {
  return (
    <div className="vault-collab-session-progress">
      <div className="vault-collab-session-progress-head">
        <span>{progress.taskLabel}</span>
        <span>{progress.percentLabel}</span>
      </div>
      <div className={`vault-collab-session-progress-rail ${progress.percent === null ? 'vault-collab-session-progress-unknown' : ''}`}>
        {progress.percent !== null ? (
          <span className="vault-collab-session-progress-fill" style={{ width: `${progress.percent}%` }} />
        ) : null}
      </div>
      {progress.blockers.length > 0 ? (
        <span className="vault-collab-session-blockers" title={progress.blockers.join(' / ')}>
          {progress.blockers.length} blocker{progress.blockers.length === 1 ? '' : 's'}
        </span>
      ) : null}
    </div>
  );
}

export function SessionCostBadge({ cost }: { cost: VaultCollabSessionHudModel['cost'] }) {
  if (!cost.available) {
    return null;
  }

  return <span className="vault-collab-cost-badge">{cost.label}</span>;
}

export function SessionRiskBadge({ risk }: { risk: VaultCollabSessionHudModel['risk'] }) {
  const title = risk.reasons.length > 0 ? risk.reasons.join(' / ') : 'No reasons reported';
  return (
    <span className={`vault-collab-risk-badge ${risk.className}`} title={title}>
      {risk.label}
    </span>
  );
}

export function SnapshotHandoffList({
  handoffs,
  onSelectHandoff,
}: {
  handoffs: VaultCollabSessionHudModel['activeHandoffs'];
  onSelectHandoff: (handoffUid: string) => void;
}) {
  if (handoffs.length === 0) {
    return null;
  }

  return (
    <div className="vault-collab-snapshot-handoff-list" aria-label="Snapshot active handoffs">
      {handoffs.map((handoff) => (
        <button
          key={handoff.uid}
          type="button"
          disabled={!handoff.canOpen}
          onClick={() => handoff.canOpen ? onSelectHandoff(handoff.uid) : undefined}
          title={handoff.progressNote ?? handoff.statusLabel}
        >
          <span className="text-mono">{handoff.shortUid}</span>
          <span>{handoff.statusLabel}</span>
          {handoff.progressNote ? <span>{handoff.progressNote}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function ToolGrantList({ grants }: { grants: VaultCollabSessionHudModel['toolGrants'] }) {
  if (grants.length === 0) {
    return null;
  }

  const visible = grants.slice(0, 3);
  const overflow = grants.slice(3);

  return (
    <div className="vault-collab-tool-grant-list" aria-label="Tool grants">
      {visible.map((grant) => (
        <span key={`${grant.toolName}:${grant.scope}`} title={grant.grantedLabel ?? undefined}>
          <strong>{grant.toolName}</strong>
          <span>{grant.scope}</span>
        </span>
      ))}
      {overflow.length > 0 ? (
        <span title={overflow.map((grant) => `${grant.toolName} / ${grant.scope}`).join(' / ')}>
          +{overflow.length}
        </span>
      ) : null}
    </div>
  );
}

export function SyncIndicator({ sync }: { sync: VaultCollabSessionHudModel['sync'] }) {
  return (
    <span className={`vault-collab-sync-indicator ${sync.stale ? 'vault-collab-sync-indicator-stale' : ''}`}>
      {sync.label}
    </span>
  );
}

function LegacySessionRow({ agent }: { agent: VaultCollabRosterAgent }) {
  return (
    <div className="vault-collab-agent-row">
      <span className="vault-collab-client-dot">
        <AgentClientIcon agent={agent} />
      </span>
      <div className="vault-collab-roster-main">
        <div className="vault-collab-row-title">
          <strong>{agent.displayName}</strong>
          <span className={`badge ${agent.status === 'working' ? 'badge-task-running' : agent.status === 'blocked' ? 'badge-task-fail' : agent.status === 'complete' ? 'badge-task-complete' : 'badge-task-pending'}`}>
            {agent.status.replace(/_/g, ' ')}
          </span>
        </div>
        <div className="vault-collab-row-meta">
          <span>{agent.roleLabel}</span>
          {agent.currentHandoffUid ? <span className="text-mono">{shortId(agent.currentHandoffUid)}</span> : <span>unassigned</span>}
          <span className={`vault-collab-connection-pill ${agent.freshness === 'fresh' ? 'vault-collab-connection-fresh' : 'vault-collab-connection-stale'}`}>
            {agent.freshness}
          </span>
        </div>
      </div>
    </div>
  );
}

function AgentClientIcon({ agent }: { agent: VaultCollabRosterAgent }) {
  const iconUrl = getAgentIconUrl(agent);
  if (iconUrl) {
    return (
      <img
        className="vault-collab-agent-client-icon"
        src={iconUrl}
        alt=""
        aria-hidden="true"
      />
    );
  }

  return <span className="vault-collab-agent-client-fallback">{agent.displayName.slice(0, 2)}</span>;
}

function getAgentIconUrl(agent: VaultCollabRosterAgent): string | null {
  if (agent.clientType === 'codex') {
    return codexIconUrl;
  }

  if (agent.clientType === 'claude-code' || agent.clientType === 'claude-desktop') {
    return claudeIconUrl;
  }

  if (agent.clientType === 'gemini') {
    return geminiIconUrl;
  }

  if (agent.clientType === 'opencode') {
    return opencodeIconUrl;
  }

  return null;
}

function shortId(value: string): string {
  return value.length > 14 ? `${value.slice(0, 14)}...` : value;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}
