// ============================================================================
// Open-Loops v2 — installation defaults and policy lookup
// ============================================================================

import { eq } from 'drizzle-orm';
import {
  authorizationPolicies,
  evidencePolicies,
} from '../database/schema.js';
import { AUTHORIZATION_ACTIONS } from '../rules/controlled-values.js';
import { getSetting, setSetting } from '../config/settings.js';
import { now } from '../utils/datetime.js';
import { generateInstallationActorUid } from '../utils/uid.js';
import type {
  AuthorizationPolicy,
  EvidencePolicy,
  EvidencePolicyRequirements,
  OpenLoopInstallationDefaults,
} from '../types/index.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../database/schema.js';

type DB = BetterSQLite3Database<typeof schema>;

export const DEFAULT_AUTHORIZATION_POLICY_UID = 'auth_default_owner_v1';
export const DEFAULT_EVIDENCE_POLICY_UID = 'evidence_default_v1';

const DEFAULT_EVIDENCE_REQUIREMENTS: EvidencePolicyRequirements = {
  minimumReferences: 1,
  fixedKinds: [
    'source',
    'commit',
    'test',
    'deployment',
    'reproduction',
    'artifact',
    'url',
    'read_back',
    'approval',
    'hash',
  ],
  duplicateKinds: ['canonical_loop'],
  retirementKinds: ['decision', 'approval'],
};

export function seedOpenLoopPolicies(db: DB): OpenLoopInstallationDefaults {
  const timestamp = now();
  const existingActor = getSetting(db, 'open_loops_installation_actor_uid');
  const actorUid = typeof existingActor === 'string' && existingActor.trim()
    ? existingActor
    : generateInstallationActorUid();

  if (actorUid !== existingActor) {
    setSetting(db, 'open_loops_installation_actor_uid', actorUid);
  }

  db.insert(authorizationPolicies)
    .values({
      policyUid: DEFAULT_AUTHORIZATION_POLICY_UID,
      name: 'Default installation owner policy',
      mode: 'owner',
      ownerActorUid: actorUid,
      allowedRolesJson: JSON.stringify([]),
      quorum: 1,
      externalProvider: null,
      actionsJson: JSON.stringify(AUTHORIZATION_ACTIONS),
      version: 1,
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoNothing()
    .run();

  db.insert(evidencePolicies)
    .values({
      policyUid: DEFAULT_EVIDENCE_POLICY_UID,
      name: 'Default evidence policy',
      requirementsJson: JSON.stringify(DEFAULT_EVIDENCE_REQUIREMENTS),
      version: 1,
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoNothing()
    .run();

  setSetting(db, 'open_loops_default_authorization_policy_uid', DEFAULT_AUTHORIZATION_POLICY_UID);
  setSetting(db, 'open_loops_default_evidence_policy_uid', DEFAULT_EVIDENCE_POLICY_UID);

  return {
    actor: {
      actorUid,
      actorKind: 'installation',
      roles: ['owner'],
    },
    authorizationPolicyUid: DEFAULT_AUTHORIZATION_POLICY_UID,
    evidencePolicyUid: DEFAULT_EVIDENCE_POLICY_UID,
  };
}

export function getOpenLoopInstallationDefaults(db: DB): OpenLoopInstallationDefaults {
  return seedOpenLoopPolicies(db);
}

export function getAuthorizationPolicy(db: DB, policyUid: string): AuthorizationPolicy | null {
  const row = db.select()
    .from(authorizationPolicies)
    .where(eq(authorizationPolicies.policyUid, policyUid))
    .get();
  if (!row) return null;
  return {
    policyUid: row.policyUid,
    name: row.name,
    mode: row.mode as AuthorizationPolicy['mode'],
    ownerActorUid: row.ownerActorUid,
    allowedRoles: parseStringArray(row.allowedRolesJson),
    quorum: row.quorum,
    externalProvider: row.externalProvider,
    actions: parseStringArray(row.actionsJson) as AuthorizationPolicy['actions'],
    version: row.version,
    enabled: row.enabled,
  };
}

export function getEvidencePolicy(db: DB, policyUid: string): EvidencePolicy | null {
  const row = db.select()
    .from(evidencePolicies)
    .where(eq(evidencePolicies.policyUid, policyUid))
    .get();
  if (!row) return null;
  return {
    policyUid: row.policyUid,
    name: row.name,
    requirements: JSON.parse(row.requirementsJson) as EvidencePolicyRequirements,
    version: row.version,
    enabled: row.enabled,
  };
}

function parseStringArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
}
