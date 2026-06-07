import {
  AlertTriangle,
  Check,
  Sparkles,
  X,
} from 'lucide-react';
import type { SparkEvolutionModel } from '../../spark-settings-view-model.js';

interface EvolutionTabProps {
  model: SparkEvolutionModel;
  actionPendingSuggestionId: string | null;
  onApproveSuggestion: (suggestionId: string) => void;
  onRejectSuggestion: (suggestionId: string) => void;
}

export function EvolutionTab({
  model,
  actionPendingSuggestionId,
  onApproveSuggestion,
  onRejectSuggestion,
}: EvolutionTabProps) {
  return (
    <div className="spark-evolution-tab">
      <section className="snippet-card spark-evolution-section" aria-labelledby="spark-evolution-title">
        <div className="snippet-head">
          <div>
            <div className="field-label" id="spark-evolution-title">Self Evolution suggestions</div>
            <div className="field-help">{model.summaryLabel}</div>
          </div>
          <Sparkles size={17} />
        </div>

        {model.rows.length === 0 ? (
          <div className="note-card">
            <p>{model.emptyLabel}</p>
          </div>
        ) : (
          <div className="spark-evolution-list" role="list" aria-label="Pending Self Evolution suggestions">
            {model.rows.map((row) => {
              const actionPending = actionPendingSuggestionId === row.suggestionId;
              return (
                <div
                  key={row.suggestionId}
                  className={`spark-evolution-row ${row.highConfidence ? 'spark-evolution-row-high-confidence' : ''}`}
                  role="listitem"
                >
                  <div className="spark-evolution-main">
                    <span className="spark-evolution-type">{row.typeLabel}</span>
                    <span className="spark-evolution-description">{row.description}</span>
                    <span className={`spark-evolution-confidence ${row.confidenceClassName}`}>
                      {row.highConfidence ? <AlertTriangle size={14} /> : null}
                      {row.confidenceLabel}
                    </span>
                    {row.highConfidence ? (
                      <span className="spark-evolution-high-confidence-label">High confidence suggestion</span>
                    ) : null}
                  </div>

                  <div className="inline-actions spark-evolution-actions">
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => onApproveSuggestion(row.suggestionId)}
                      disabled={actionPending}
                      title={`Approve ${row.typeLabel} suggestion`}
                    >
                      <Check size={15} />
                      <span>{actionPending ? 'Updating...' : 'Approve'}</span>
                    </button>
                    <button
                      type="button"
                      className="danger-button"
                      onClick={() => onRejectSuggestion(row.suggestionId)}
                      disabled={actionPending}
                      title={`Reject ${row.typeLabel} suggestion`}
                    >
                      <X size={15} />
                      <span>{actionPending ? 'Updating...' : 'Reject'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
