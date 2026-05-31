import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import type { VaultCollabSelectedHandoff } from '../../vault-collab-view-model.js';

type VaultCollabDashboardActionInput = Parameters<typeof window.vaultAPI.performVaultCollabDashboardAction>[0];

interface UseVaultCollabActionsOptions {
  discussionDraft: string;
  selectedHandoff: VaultCollabSelectedHandoff | null;
  loadDashboard: (silent?: boolean) => Promise<void>;
  setApprovedLaunchCommands: Dispatch<SetStateAction<Record<string, string>>>;
  setDashboardSessionUid: Dispatch<SetStateAction<string | null>>;
  setDiscussionDraft: Dispatch<SetStateAction<string>>;
}

export function useVaultCollabActions({
  discussionDraft,
  selectedHandoff,
  loadDashboard,
  setApprovedLaunchCommands,
  setDashboardSessionUid,
  setDiscussionDraft,
}: UseVaultCollabActionsOptions) {
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  async function performDashboardAction(input: VaultCollabDashboardActionInput, busyKey: string): Promise<unknown | null> {
    setActionBusy(busyKey);
    setActionError(null);
    setActionNotice(null);

    try {
      const response = await window.vaultAPI.performVaultCollabDashboardAction(input);
      if (!response.success || !response.data?.ok) {
        throw new Error(response.error || response.data?.error || 'Vault Collab action failed');
      }

      const actionData = response.data.data;
      if (actionData && typeof actionData === 'object' && 'claimedBySessionUid' in actionData) {
        const claimedBySessionUid = (actionData as { claimedBySessionUid?: unknown }).claimedBySessionUid;
        if (typeof claimedBySessionUid === 'string') {
          setDashboardSessionUid(claimedBySessionUid);
        }
      }

      await loadDashboard(true);
      return actionData;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Vault Collab action failed');
      return null;
    } finally {
      setActionBusy(null);
    }
  }

  async function runHandoffAction(action: string, handoffUid: string) {
    if (action === 'claim' || action === 'release') {
      await performDashboardAction({ kind: 'handoff', action, handoffUid }, `${handoffUid}:${action}`);
      return;
    }

    if (action === 'update_in_progress' || action === 'update_verification_needed') {
      await performDashboardAction({
        kind: 'handoff',
        action: 'update',
        handoffUid,
        progressNote: action === 'update_in_progress'
          ? 'Updated from The Vault dashboard.'
          : 'Ready for verification from The Vault dashboard.',
        status: action === 'update_in_progress' ? 'in_progress' : 'verification_needed',
      }, `${handoffUid}:${action}`);
      return;
    }

    if (action === 'update_blocked' || action === 'update_awaiting_user') {
      const progressNote = window.prompt(action === 'update_blocked' ? 'Blocker note' : 'User request note');
      if (!progressNote?.trim()) {
        return;
      }
      await performDashboardAction({
        kind: 'handoff',
        action: 'update',
        handoffUid,
        progressNote: progressNote.trim(),
        status: action === 'update_blocked' ? 'blocked' : 'awaiting_user',
      }, `${handoffUid}:${action}`);
      return;
    }

    if (action === 'resolve') {
      const summary = window.prompt('Resolution summary');
      if (summary?.trim()) {
        await performDashboardAction({ kind: 'handoff', action: 'resolve', handoffUid, summary: summary.trim() }, `${handoffUid}:resolve`);
      }
      return;
    }

    if (action === 'reopen') {
      const reason = window.prompt('Reopen reason');
      if (reason?.trim()) {
        await performDashboardAction({ kind: 'handoff', action: 'reopen', handoffUid, reason: reason.trim() }, `${handoffUid}:reopen`);
      }
    }
  }

  async function runLaunchAction(action: string, launchRequestUid: string) {
    if (action === 'approve') {
      await approveLaunchRequest(launchRequestUid);
      return;
    }

    if (action === 'mark_launching') {
      await prepareLaunchCommand(launchRequestUid);
      return;
    }

    if (action === 'reject' || action === 'cancel' || action === 'fail') {
      const reason = window.prompt(action === 'reject' ? 'Rejection reason' : action === 'cancel' ? 'Cancellation reason' : 'Launch failure reason');
      if (reason?.trim()) {
        await performDashboardAction({ kind: 'launch', action, launchRequestUid, reason: reason.trim() }, `${launchRequestUid}:${action}`);
      }
    }
  }

  async function approveLaunchRequest(launchRequestUid: string) {
    setActionBusy(`${launchRequestUid}:approve`);
    setActionError(null);
    setActionNotice(null);
    try {
      const response = await window.vaultAPI.approveVaultCollabLaunchRequest(launchRequestUid);
      if (!response.success || !response.data?.ok || !response.data.launchCommand) {
        throw new Error(response.error || response.data?.error || 'Vault Collab launch approval failed');
      }

      setApprovedLaunchCommands((current) => ({
        ...current,
        [launchRequestUid]: response.data!.launchCommand!.display,
      }));
      setActionNotice('Launch command ready. Run it in a new terminal to start the agent.');
      await loadDashboard(true);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Vault Collab launch approval failed');
    } finally {
      setActionBusy(null);
    }
  }

  async function prepareLaunchCommand(launchRequestUid: string) {
    setActionBusy(`${launchRequestUid}:mark_launching`);
    setActionError(null);
    setActionNotice(null);
    try {
      const response = await window.vaultAPI.startVaultCollabLaunchRequest(launchRequestUid);
      if (!response.success || !response.data) {
        throw new Error(response.error || 'The Vault launch request could not be prepared.');
      }

      setApprovedLaunchCommands((current) => ({
        ...current,
        [launchRequestUid]: response.data!.display,
      }));
      setActionNotice('Launch command ready. Run it in a new terminal to start the agent.');
      await loadDashboard(true);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'The Vault launch request could not be prepared.');
    } finally {
      setActionBusy(null);
    }
  }

  async function runDiscussionAction() {
    const body = discussionDraft.trim();
    if (!selectedHandoff || !body) {
      setActionError('Write a discussion message first.');
      return;
    }

    const openThread = selectedHandoff.discussionThreads.find((thread) => thread.status === 'open')
      ?? selectedHandoff.discussionThreads[0];
    if (openThread) {
      await performDashboardAction({
        kind: 'discussion',
        action: 'add_message',
        threadUid: openThread.uid,
        messageType: 'note',
        body,
      }, `${selectedHandoff.uid}:discussion`);
      setDiscussionDraft('');
      return;
    }

    const title = window.prompt('Thread title', 'Dashboard discussion');
    if (!title?.trim()) {
      return;
    }

    const createResult = await performDashboardAction({
      kind: 'discussion',
      action: 'create_thread',
      handoffUid: selectedHandoff.uid,
      project: 'the-vault',
      title: title.trim(),
    }, `${selectedHandoff.uid}:discussion`);
    const threadUid = createResult && typeof createResult === 'object'
      ? (createResult as { threadUid?: unknown }).threadUid
      : null;
    if (typeof threadUid === 'string') {
      await performDashboardAction({
        kind: 'discussion',
        action: 'add_message',
        threadUid,
        messageType: 'note',
        body,
      }, `${selectedHandoff.uid}:discussion-message`);
    }
    setDiscussionDraft('');
  }

  async function copyLaunchCommand(_launchRequestUid: string, command: string) {
    try {
      await navigator.clipboard.writeText(command);
      setActionNotice('Launch command copied. Run it in a new terminal to start the agent.');
      setActionError(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not copy launch command');
    }
  }

  return {
    actionBusy,
    actionError,
    actionNotice,
    copyLaunchCommand,
    runDiscussionAction,
    runHandoffAction,
    runLaunchAction,
  };
}
