import {
  Activity,
  BrainCircuit,
  Clock3,
  ExternalLink,
  Power,
} from 'lucide-react';
import type { SparkOverviewModel } from '../../spark-settings-view-model.js';

interface OverviewTabProps {
  model: SparkOverviewModel;
  actionPending: boolean;
  onToggleEnabled: () => void;
}

export function OverviewTab({ model, actionPending, onToggleEnabled }: OverviewTabProps) {
  const toggleDisabled = model.extensionToggle.disabled || actionPending;

  return (
    <div className="spark-overview-tab">
      <div className="settings-card-grid spark-overview-grid">
        <div className="snippet-card spark-overview-status-card">
          <div className="snippet-head">
            <div>
              <div className="field-label">Install status</div>
              <div className="field-help">{model.installDetail}</div>
            </div>
            <Activity size={17} />
          </div>
          <div className="spark-overview-primary-status">
            <strong>{model.installStatusLabel}</strong>
            <span>{model.sourceLabel} / {model.versionLabel}</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={model.extensionToggle.enabled}
            className={`spark-extension-toggle ${model.extensionToggle.enabled ? 'spark-extension-toggle-on' : ''}`}
            onClick={() => onToggleEnabled()}
            disabled={toggleDisabled}
            title={model.extensionToggle.disabled ? 'Spark cannot be toggled until the extension is installed.' : model.extensionToggle.label}
          >
            <span className="spark-extension-toggle-track" aria-hidden="true">
              <span className="spark-extension-toggle-thumb" />
            </span>
            <Power size={15} />
            <span>{actionPending ? 'Updating...' : model.extensionToggle.label}</span>
          </button>
        </div>

        <div className="snippet-card spark-overview-status-card">
          <div className="snippet-head">
            <div>
              <div className="field-label">Spark Brain Vault project</div>
              <div className="field-help">Generated Brain artifacts stay backed by Vault memory.</div>
            </div>
            <BrainCircuit size={17} />
          </div>
          {model.brainProjectLink ? (
            <a className="spark-project-link" href={model.brainProjectLink.href}>
              <span>{model.brainProjectLink.label}</span>
              <ExternalLink size={15} />
            </a>
          ) : (
            <div className="spark-project-link spark-project-link-empty">No Spark Brain project</div>
          )}
          <div className="spark-overview-sync">
            <Clock3 size={15} />
            <span>{model.lastSyncLabel}</span>
          </div>
        </div>
      </div>

      <div className="snippet-card">
        <div className="snippet-head">
          <div>
            <div className="field-label">Health summary</div>
            <div className="field-help">{model.healthSummary}</div>
          </div>
          <Activity size={17} />
        </div>
        <div className="spark-overview-metrics">
          {model.metrics.map((metric) => (
            <div key={metric.label} className="spark-overview-metric">
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </div>
          ))}
        </div>
        {model.issues.length > 0 ? (
          <ul className="settings-guide-list spark-overview-issues">
            {model.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
