import { useState, type FormEvent } from 'react';
import { Circle, KeyRound } from 'lucide-react';
import type { SparkProviderRole } from '@the-vault/core';
import type {
  SparkProviderCatalogRowModel,
  SparkProviderRegistryModel,
} from '../../spark-settings-view-model.js';

interface ProvidersTabProps {
  model: SparkProviderRegistryModel;
  providerPending: string | null;
  roleAssignmentPending: SparkProviderRole | null;
  onConfigureProvider: (providerId: string, key: string, baseUrl?: string | null) => void;
  onAssignRole: (role: SparkProviderRole, providerId: string) => void;
  error?: string | null;
}

export function ProvidersTab({
  model,
  providerPending,
  roleAssignmentPending,
  onConfigureProvider,
  onAssignRole,
  error,
}: ProvidersTabProps) {
  return (
    <div className="spark-providers-tab">
      <div className="spark-providers-header">
        <div>
          <div className="field-label">Provider registry</div>
          <div className="field-help">{model.summaryLabel}</div>
        </div>
      </div>

      {error ? (
        <div className="note-card note-card-warning">
          <p>{error}</p>
        </div>
      ) : null}

      <div className="spark-role-assignments" aria-label="Spark role assignments">
        <div className="field-label">Role assignments</div>
        <div className="spark-role-assignment-grid">
          {model.roleAssignmentRows.map((row) => {
            const selectId = `spark-role-${row.role}`;
            return (
              <div key={row.role} className="spark-role-assignment-row">
                <label htmlFor={selectId}>{row.label}</label>
                <select
                  id={selectId}
                  value={row.selectedProviderId}
                  disabled={roleAssignmentPending === row.role}
                  onChange={(event) => onAssignRole(row.role, event.target.value)}
                >
                  {row.options.map((option) => (
                    <option key={option.providerId} value={option.providerId}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </div>

      <div className="spark-provider-list" role="list" aria-label="Spark providers">
        {model.catalogRows.map((row) => (
          <ProviderCatalogCard
            key={row.providerId}
            row={row}
            pending={providerPending === row.providerId}
            onConfigure={onConfigureProvider}
          />
        ))}
      </div>
    </div>
  );
}

interface ProviderCatalogCardProps {
  row: SparkProviderCatalogRowModel;
  pending: boolean;
  onConfigure: (providerId: string, key: string, baseUrl?: string | null) => void;
}

function ProviderCatalogCard({ row, pending, onConfigure }: ProviderCatalogCardProps) {
  // Key is held only transiently in local state and cleared on submit — it is
  // never persisted in the renderer, the model, or any snapshot.
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(row.defaultBaseUrl ?? '');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedKey = apiKey.trim();
    if (row.requiresKey && trimmedKey.length === 0) {
      return;
    }

    const trimmedBaseUrl = baseUrl.trim();
    onConfigure(row.providerId, trimmedKey, row.requiresBaseUrl ? trimmedBaseUrl : trimmedBaseUrl || null);
    // Never retain the key in the renderer after a save.
    setApiKey('');
  }

  return (
    <div className="spark-provider-row" role="listitem">
      <div className="spark-provider-name">
        <strong>{row.name}</strong>
        {row.isDefault ? (
          <span className="spark-provider-default">Default (always available)</span>
        ) : null}
      </div>
      <span className={`spark-provider-health ${row.statusClassName}`}>
        <Circle size={10} fill="currentColor" />
        {row.statusLabel}
      </span>
      <span className="spark-provider-roles">{row.rolesLabel}</span>
      {row.description ? <p className="spark-provider-description">{row.description}</p> : null}

      <form className="spark-provider-configure-form" onSubmit={handleSubmit}>
        {row.requiresBaseUrl ? (
          <label className="spark-provider-field">
            <span>Base URL</span>
            <input
              type="text"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://your-host.example/v1"
              aria-label={`${row.name} base URL`}
            />
            <small className="spark-provider-field-hint">
              The provider API endpoint — a hosted VPS or a local server (e.g. http://localhost:3001/v1 for FreeLLMAPI). Include the /v1 path.
            </small>
          </label>
        ) : null}
        {row.requiresKey ? (
          <label className="spark-provider-field">
            <span>API key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="••••••••"
              aria-label={`${row.name} API key`}
              autoComplete="off"
            />
          </label>
        ) : null}
        <button
          type="submit"
          className="header-button header-button-compact"
          disabled={pending}
          aria-label={`Configure ${row.name}`}
        >
          <KeyRound size={15} />
          <span>{pending ? 'Saving...' : row.configured ? 'Update credential' : 'Save credential'}</span>
        </button>
      </form>
    </div>
  );
}
