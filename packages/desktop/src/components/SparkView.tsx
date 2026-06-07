import { SparkControlPage } from './spark/SparkControlPage.js';

/**
 * Dedicated Spark extension page, surfaced from the Extensions sidebar section
 * (alongside Graphify and Vault Collab). This is the real Spark Control Page
 * (S1) — a status/capabilities/readiness surface plus the inert session frame —
 * NOT the Settings > Extensions Spark configuration panel, which remains the
 * place for provider/skill/pack configuration.
 */
export function SparkView() {
  return (
    <div className="spark-view">
      <SparkControlPage />
    </div>
  );
}
