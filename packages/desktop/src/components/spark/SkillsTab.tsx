import {
  Circle,
  Power,
  Search,
  ShieldCheck,
} from 'lucide-react';
import type { SparkSkillsModel } from '../../spark-settings-view-model.js';

interface SkillsTabProps {
  model: SparkSkillsModel;
  actionPendingSkillId: string | null;
  onToggleSkill: (skillId: string) => void;
}

export function SkillsTab({ model, actionPendingSkillId, onToggleSkill }: SkillsTabProps) {
  return (
    <div className="spark-skills-tab">
      <section className="snippet-card spark-skills-section" aria-labelledby="spark-installed-skills-title">
        <div className="snippet-head">
          <div>
            <div className="field-label" id="spark-installed-skills-title">Installed skills</div>
            <div className="field-help">{model.summaryLabel}</div>
          </div>
          <ShieldCheck size={17} />
        </div>

        {model.installedRows.length === 0 ? (
          <div className="note-card">
            <p>{model.installedEmptyLabel}</p>
          </div>
        ) : (
          <div className="spark-skill-list" role="list" aria-label="Installed Spark skills">
            {model.installedRows.map((row) => {
              const actionPending = actionPendingSkillId === row.skillId;
              return (
                <div key={row.skillId} className="spark-skill-row spark-installed-skill-row" role="listitem">
                  <div className="spark-skill-identity">
                    <strong>{row.name}</strong>
                    <span>{row.namespace}</span>
                  </div>
                  <span className="spark-skill-meta">{row.versionLabel}</span>
                  <span className={`spark-skill-state ${row.stateClassName}`}>
                    <Circle size={10} fill="currentColor" />
                    {row.stateLabel}
                  </span>
                  <span className="spark-skill-meta">{row.packSourceLabel}</span>
                  <span className="spark-skill-permissions">{row.permissionsSummary}</span>
                  <span className={`spark-skill-execution ${row.executionLabel === 'Discovery-only' ? 'spark-skill-discovery-only' : ''}`}>
                    {row.executionLabel}
                  </span>
                  <span className="spark-skill-meta spark-skill-contracts">{row.outputContractsSummary}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={row.stateLabel === 'Enabled'}
                    className="header-button header-button-compact"
                    onClick={() => onToggleSkill(row.skillId)}
                    disabled={row.toggleDisabled || actionPending}
                    title={row.lockedReasonLabel ?? row.toggleLabel}
                  >
                    <Power size={15} />
                    <span>{actionPending ? 'Updating...' : row.toggleLabel}</span>
                  </button>
                  {row.lockedReasonLabel ? (
                    <span className="spark-skill-lock-note">{row.lockedReasonLabel}</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="snippet-card spark-skills-section" aria-labelledby="spark-catalog-skills-title">
        <div className="snippet-head">
          <div>
            <div className="field-label" id="spark-catalog-skills-title">Catalog</div>
            <div className="field-help">Available skills not installed in the current Spark snapshot.</div>
          </div>
          <Search size={17} />
        </div>

        {model.catalogRows.length === 0 ? (
          <div className="note-card">
            <p>{model.catalogEmptyLabel}</p>
          </div>
        ) : (
          <div className="spark-skill-catalog-list" role="list" aria-label="Available Spark catalog skills">
            {model.catalogRows.map((row) => (
              <div key={row.skillId} className="spark-skill-catalog-row" role="listitem">
                <div className="spark-skill-identity">
                  <strong>{row.name}</strong>
                  <span>{row.namespace}</span>
                </div>
                <span className="spark-skill-meta">{row.categoryLabel}</span>
                <span className="spark-skill-meta">{row.versionLabel}</span>
                <span className="spark-skill-meta">{row.packSourceLabel}</span>
                <span className="spark-skill-permissions">{row.permissionsSummary}</span>
                <span className={`spark-skill-execution ${row.executionLabel === 'Discovery-only' ? 'spark-skill-discovery-only' : ''}`}>
                  {row.executionLabel}
                </span>
                <span className="spark-skill-description">{row.description}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
