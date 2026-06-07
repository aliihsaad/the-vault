import {
  Archive,
  ChevronDown,
  Download,
  Trash2,
} from 'lucide-react';
import type { SparkPacksModel } from '../../spark-settings-view-model.js';

interface PacksTabProps {
  model: SparkPacksModel;
  actionPendingPackId: string | null;
  onInstallPack: (packId: string) => void;
  onUninstallPack: (packId: string) => void;
}

export function PacksTab({
  model,
  actionPendingPackId,
  onInstallPack,
  onUninstallPack,
}: PacksTabProps) {
  return (
    <div className="spark-packs-tab">
      <section className="snippet-card spark-packs-section" aria-labelledby="spark-packs-title">
        <div className="snippet-head">
          <div>
            <div className="field-label" id="spark-packs-title">Capability packs</div>
            <div className="field-help">{model.summaryLabel}</div>
          </div>
          <Archive size={17} />
        </div>

        {model.rows.length === 0 ? (
          <div className="note-card">
            <p>{model.emptyLabel}</p>
          </div>
        ) : (
          <div className="spark-pack-list" role="list" aria-label="Spark capability packs">
            {model.rows.map((row) => {
              const actionPending = actionPendingPackId === row.packId;
              const ActionIcon = row.action.type === 'install-pack' ? Download : Trash2;
              return (
                <div key={row.packId} className="spark-pack-row" role="listitem">
                  <div className="spark-pack-main">
                    <div className="spark-pack-identity">
                      <strong>{row.name}</strong>
                      <span>{row.description}</span>
                    </div>
                    <span className="spark-pack-count">{row.includedSkillsCountLabel}</span>
                    <span className={`spark-pack-status ${row.statusClassName}`}>{row.statusLabel}</span>
                    <button
                      type="button"
                      className={row.actionClassName}
                      onClick={() => {
                        if (row.action.type === 'install-pack') {
                          onInstallPack(row.packId);
                        } else {
                          onUninstallPack(row.packId);
                        }
                      }}
                      disabled={actionPending}
                      title={`${row.actionLabel} ${row.name}`}
                    >
                      <ActionIcon size={15} />
                      <span>{actionPending ? 'Updating...' : row.actionLabel}</span>
                    </button>
                  </div>

                  <details className="spark-pack-preview">
                    <summary>
                      <ChevronDown size={15} />
                      <span>Included skills</span>
                    </summary>
                    {row.includedSkills.length === 0 ? (
                      <p>No included skills are listed for this pack.</p>
                    ) : (
                      <ul>
                        {row.includedSkills.map((skill) => (
                          <li key={skill}>{skill}</li>
                        ))}
                      </ul>
                    )}
                  </details>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
