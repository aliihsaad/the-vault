import { AlertTriangle, CheckCircle2, Copy, Rocket } from 'lucide-react';

import type {
  VaultCollabLaunchRequestRow,
  VaultCollabNeedsYouItem,
} from '../../vault-collab-view-model.js';

interface NeedsYouProps {
  items: VaultCollabNeedsYouItem[];
  launchRequests: VaultCollabLaunchRequestRow[];
  actionBusy: string | null;
  onLaunchAction: (action: string, launchRequestUid: string) => void;
  onHandoffAction: (action: string, handoffUid: string) => void;
  onCopyLaunchCommand: (launchRequestUid: string, command: string) => void;
}

export function NeedsYou({
  items,
  launchRequests,
  actionBusy,
  onLaunchAction,
  onHandoffAction,
  onCopyLaunchCommand,
}: NeedsYouProps) {
  return (
    <section className="vault-collab-needs-you" aria-label="Needs You">
      <div className="vault-collab-zone-header">
        <div>
          <strong>Needs You</strong>
          <span>{items.length === 0 ? 'All clear' : `${items.length} waiting`}</span>
        </div>
        {items.length === 0 ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
      </div>

      {items.length === 0 ? (
        <div className="empty-state">All clear.</div>
      ) : (
        <div className="vault-collab-needs-list">
          {items.map((item) => {
            const launchRequest = item.kind === 'launch_approval'
              ? launchRequests.find((request) => request.uid === item.id) ?? null
              : null;

            return (
              <div key={`${item.kind}:${item.id}`} className="vault-collab-need-row">
                <span className="vault-collab-need-icon">
                  {item.kind === 'launch_approval' ? <Rocket size={15} /> : <AlertTriangle size={15} />}
                </span>
                <div className="vault-collab-need-main">
                  <div className="vault-collab-row-title">
                    <strong>{item.title}</strong>
                    <span className="text-mono">{shortId(item.id)}</span>
                  </div>
                  {item.subtitle ? <p>{item.subtitle}</p> : null}
                  {launchRequest?.approvedLaunchCommand ? (
                    <div className="vault-collab-approved-command">
                      <span className="vault-collab-command-preview text-mono">{launchRequest.approvedLaunchCommand}</span>
                      <button
                        type="button"
                        className="header-button"
                        onClick={() => onCopyLaunchCommand(launchRequest.uid, launchRequest.approvedLaunchCommand!)}
                        title="Copy launch command"
                      >
                        <Copy size={14} />
                        <span>Copy</span>
                      </button>
                    </div>
                  ) : null}
                  {item.actions.length > 0 ? (
                    <div className="inline-actions vault-collab-action-row">
                      {item.actions.map((action) => (
                        <button
                          key={action.action}
                          type="button"
                          className={action.tone === 'danger' ? 'danger-button' : action.tone === 'primary' ? 'primary-button' : 'header-button'}
                          disabled={action.disabled || actionBusy === `${item.id}:${action.action}`}
                          title={action.reason ?? action.label}
                          onClick={() => {
                            if (item.kind === 'launch_approval') {
                              onLaunchAction(action.action, item.id);
                            } else {
                              onHandoffAction(action.action, item.id);
                            }
                          }}
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function shortId(value: string): string {
  return value.length > 14 ? `${value.slice(0, 14)}...` : value;
}
