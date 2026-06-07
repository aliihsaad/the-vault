import {
  AlertTriangle,
  Check,
  ShieldAlert,
  X,
} from 'lucide-react';
import type { SparkApprovalsModel } from '../../spark-settings-view-model.js';

interface ApprovalsTabProps {
  model: SparkApprovalsModel;
  actionPendingApprovalId: string | null;
  onApproveSkill: (proposalId: string) => void;
  onRejectSkill: (proposalId: string) => void;
}

export function ApprovalsTab({
  model,
  actionPendingApprovalId,
  onApproveSkill,
  onRejectSkill,
}: ApprovalsTabProps) {
  return (
    <div className="spark-approvals-tab">
      <section className="snippet-card spark-approvals-section" aria-labelledby="spark-approvals-title">
        <div className="snippet-head">
          <div>
            <div className="field-label" id="spark-approvals-title">Skill Creator approvals</div>
            <div className="field-help">{model.summaryLabel}</div>
          </div>
          <ShieldAlert size={17} />
        </div>

        {model.rows.length === 0 ? (
          <div className="note-card">
            <p>{model.emptyLabel}</p>
          </div>
        ) : (
          <div className="spark-approval-list" role="list" aria-label="Pending Skill Creator approvals">
            {model.rows.map((row) => {
              const actionPending = actionPendingApprovalId === row.proposalId;
              return (
                <div
                  key={row.proposalId}
                  className={`spark-approval-row ${row.highRisk ? 'spark-approval-row-high-risk' : ''}`}
                  role="listitem"
                >
                  <div className="spark-approval-main">
                    <div className="spark-approval-identity">
                      <strong>{row.skillName}</strong>
                      <span>{row.purpose}</span>
                    </div>
                    <span className="spark-approval-permissions">{row.requiredPermissionsSummary}</span>
                    <span className={`spark-approval-risk ${row.riskClassName}`}>
                      {row.highRisk ? <AlertTriangle size={14} /> : null}
                      {row.riskLabel}
                    </span>
                    {row.highRisk ? (
                      <span className="spark-approval-high-risk-label">Higher risk proposal</span>
                    ) : null}
                  </div>
                  <div className="inline-actions spark-approval-actions">
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => onApproveSkill(row.proposalId)}
                      disabled={actionPending}
                      title={`Approve ${row.skillName}`}
                    >
                      <Check size={15} />
                      <span>{actionPending ? 'Updating...' : 'Approve'}</span>
                    </button>
                    <button
                      type="button"
                      className="danger-button"
                      onClick={() => onRejectSkill(row.proposalId)}
                      disabled={actionPending}
                      title={`Reject ${row.skillName}`}
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
