import type { ReactNode } from 'react';
import {
  BrainCircuit,
  Clock,
  FileText,
  Hash,
} from 'lucide-react';
import type { SparkBrainModel } from '../../spark-settings-view-model.js';

interface BrainTabProps {
  model: SparkBrainModel;
}

export function BrainTab({ model }: BrainTabProps) {
  return (
    <div className="spark-brain-tab">
      <section className="snippet-card spark-brain-section" aria-labelledby="spark-brain-title">
        <div className="snippet-head">
          <div>
            <div className="field-label" id="spark-brain-title">Brain artifacts</div>
            <div className="field-help">{model.summaryLabel}</div>
          </div>
          <BrainCircuit size={17} />
        </div>

        <div className="spark-brain-artifact-list" role="list" aria-label="Spark Brain artifacts">
          {model.rows.map((row) => (
            <article key={row.artifactName} className="spark-brain-artifact-row" role="listitem">
              <div className="spark-brain-artifact-header">
                <div className="spark-brain-artifact-title">
                  <FileText size={16} />
                  <strong>{row.displayName}</strong>
                </div>
                <span className={`spark-brain-freshness ${row.freshnessClassName}`}>
                  {row.freshnessLabel}
                </span>
              </div>

              <div className="spark-brain-artifact-meta" aria-label={`${row.displayName} metadata`}>
                <span>
                  <Clock size={14} />
                  {row.renderedAtLabel}
                </span>
                <span>
                  <Hash size={14} />
                  {row.contentHashLabel}
                </span>
                <span>{row.sourceProjectLabel}</span>
              </div>

              {row.staleReasonLabel ? (
                <div className="note-card note-card-warning spark-brain-stale-note">
                  <p>{row.staleReasonLabel}</p>
                </div>
              ) : null}

              <div className="spark-brain-markdown" aria-label={`${row.displayName} read-only markdown`}>
                {renderMarkdown(row.markdownContent)}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function renderMarkdown(markdown: string): ReactNode[] {
  const lines = markdown.split(/\r?\n/);
  const nodes: ReactNode[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      continue;
    }

    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith('```')) {
        codeLines.push(lines[index]);
        index += 1;
      }
      nodes.push(<pre key={`code-${index}`}><code>{codeLines.join('\n')}</code></pre>);
      continue;
    }

    if (line.startsWith('# ')) {
      nodes.push(<h3 key={`h1-${index}`}>{line.slice(2).trim()}</h3>);
      continue;
    }

    if (line.startsWith('## ')) {
      nodes.push(<h4 key={`h2-${index}`}>{line.slice(3).trim()}</h4>);
      continue;
    }

    if (line.startsWith('### ')) {
      nodes.push(<h5 key={`h3-${index}`}>{line.slice(4).trim()}</h5>);
      continue;
    }

    if (line.startsWith('- ') || line.startsWith('* ')) {
      const items: string[] = [];
      while (index < lines.length && (lines[index].startsWith('- ') || lines[index].startsWith('* '))) {
        items.push(lines[index].slice(2).trim());
        index += 1;
      }
      index -= 1;
      nodes.push(
        <ul key={`list-${index}`}>
          {items.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}>{item}</li>)}
        </ul>,
      );
      continue;
    }

    nodes.push(<p key={`p-${index}`}>{line}</p>);
  }

  return nodes;
}
