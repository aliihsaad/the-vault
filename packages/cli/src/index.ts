#!/usr/bin/env node
// ============================================================================
// Vault — CLI Test Harness
// Simple command-line interface for testing Vault operations.
// ============================================================================

import { Command } from 'commander';
import chalk from 'chalk';
import { Vault, MEMORY_TYPES, STATUS_VALUES, PRIORITY_VALUES, SOURCE_APPS } from '@the-vault/core';

const program = new Command();
const vault = new Vault();

program
  .name('vault')
  .description('Vault CLI — test harness for the AI memory operating system')
  .version('0.1.0');

// ============================================================================
// Command: init
// ============================================================================
program
  .command('init')
  .description('Initialize the Vault root directory and database')
  .action(() => {
    try {
      vault.initialize();
      console.log(chalk.green('✓ Vault initialized successfully'));
      console.log(chalk.dim(`  Root: ${vault.getVaultRoot()}`));

      const projects = vault.listProjects();
      console.log(chalk.dim(`  Projects: ${projects.length}`));

      const settings = vault.getAllSettings();
      console.log(chalk.dim(`  Settings: ${Object.keys(settings).length} configured`));

      vault.close();
    } catch (error) {
      console.error(chalk.red('✗ Failed to initialize Vault:'), error);
      process.exit(1);
    }
  });

// ============================================================================
// Command: save
// ============================================================================
program
  .command('save')
  .description('Save a memory item')
  .requiredOption('-p, --project <project>', 'Project name')
  .requiredOption('-t, --type <type>', `Memory type: ${MEMORY_TYPES.join(', ')}`)
  .requiredOption('-s, --subject <subject>', 'Subject')
  .requiredOption('--summary <summary>', 'Summary')
  .option('--title <title>', 'Title (defaults to subject)')
  .option('-k, --keywords <keywords>', 'Comma-separated keywords')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--priority <priority>', `Priority: ${PRIORITY_VALUES.join(', ')}`)
  .option('--source <source>', `Source app: ${SOURCE_APPS.join(', ')}`)
  .option('--content <content>', 'Full content')
  .option('--next-steps <steps>', 'Comma-separated next steps')
  .action((opts) => {
    try {
      vault.initialize();

      const result = vault.saveMemory({
        title: opts.title || opts.subject,
        project: opts.project,
        memoryType: opts.type,
        subject: opts.subject,
        summary: opts.summary,
        content: opts.content,
        keywords: opts.keywords ? opts.keywords.split(',').map((k: string) => k.trim()) : [],
        tags: opts.tags ? opts.tags.split(',').map((t: string) => t.trim()) : [],
        priority: opts.priority,
        sourceApp: opts.source,
        nextSteps: opts.nextSteps ? opts.nextSteps.split(',').map((s: string) => s.trim()) : [],
      });

      console.log(chalk.green('✓ Memory saved'));
      console.log(chalk.dim(`  UID:  ${result.item.itemUid}`));
      console.log(chalk.dim(`  Path: ${result.vaultPath}`));
      console.log(chalk.dim(`  ${result.message}`));

      vault.close();
    } catch (error) {
      console.error(chalk.red('✗ Save failed:'), error);
      process.exit(1);
    }
  });

// ============================================================================
// Command: find
// ============================================================================
program
  .command('find')
  .description('Find memory items')
  .option('-p, --project <project>', 'Filter by project')
  .option('-t, --type <type>', 'Filter by memory type')
  .option('-s, --subject <subject>', 'Filter by subject')
  .option('-k, --keywords <keywords>', 'Comma-separated keywords')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--status <status>', 'Filter by status')
  .option('-l, --limit <limit>', 'Max results', '10')
  .action((opts) => {
    try {
      vault.initialize();

      const results = vault.findMemory({
        project: opts.project,
        memoryType: opts.type,
        subject: opts.subject,
        keywords: opts.keywords ? opts.keywords.split(',').map((k: string) => k.trim()) : undefined,
        tags: opts.tags ? opts.tags.split(',').map((t: string) => t.trim()) : undefined,
        status: opts.status,
        limit: parseInt(opts.limit),
      });

      if (results.length === 0) {
        console.log(chalk.yellow('No memories found.'));
      } else {
        console.log(chalk.green(`Found ${results.length} memories:\n`));
        for (const item of results) {
          console.log(chalk.bold(`  ${item.title}`));
          console.log(chalk.dim(`    UID: ${item.itemUid} | Type: ${item.memoryType} | Project: ${item.project}`));
          console.log(chalk.dim(`    Subject: ${item.subject}`));
          console.log(chalk.dim(`    Summary: ${item.summary.slice(0, 100)}${item.summary.length > 100 ? '...' : ''}`));
          console.log(chalk.dim(`    Tags: ${item.tags.join(', ')} | Status: ${item.status} | Priority: ${item.priority}`));
          console.log();
        }
      }

      vault.close();
    } catch (error) {
      console.error(chalk.red('✗ Find failed:'), error);
      process.exit(1);
    }
  });

// ============================================================================
// Command: recall
// ============================================================================
program
  .command('recall')
  .description('Smart recall — get ranked relevant memory')
  .option('-p, --project <project>', 'Project context')
  .option('-s, --subject <subject>', 'Subject hint')
  .option('-k, --keywords <keywords>', 'Comma-separated keywords')
  .option('-q, --query <query>', 'Natural language query')
  .option('-l, --limit <limit>', 'Max results', '5')
  .action(async (opts) => {
    try {
      vault.initialize();

      const pack = await vault.recallContext({
        project: opts.project,
        subject: opts.subject,
        keywords: opts.keywords ? opts.keywords.split(',').map((k: string) => k.trim()) : undefined,
        queryText: opts.query,
        limit: parseInt(opts.limit),
      });

      console.log(chalk.green(`Recall complete (${pack.totalCandidates} candidates, top score: ${pack.topScore}):\n`));

      if (pack.contextSummary) {
        console.log(chalk.bold.white('  Context Summary:'));
        console.log(chalk.dim(`    ${pack.contextSummary}`));
        console.log();
      }

      if (pack.decisions.length > 0) {
        console.log(chalk.bold.cyan('  Decisions:'));
        for (const d of pack.decisions) {
          console.log(chalk.dim(`    • ${d.title} — ${d.summary.slice(0, 80)}`));
        }
        console.log();
      }
      if (pack.plans.length > 0) {
        console.log(chalk.bold.cyan('  Plans:'));
        for (const p of pack.plans) {
          console.log(chalk.dim(`    • ${p.title} — ${p.summary.slice(0, 80)}`));
        }
        console.log();
      }
      if (pack.summaries.length > 0) {
        console.log(chalk.bold.cyan('  Summaries/Sessions:'));
        for (const s of pack.summaries) {
          console.log(chalk.dim(`    • ${s.title} — ${s.summary.slice(0, 80)}`));
        }
        console.log();
      }
      if (pack.other.length > 0) {
        console.log(chalk.bold.cyan('  Other:'));
        for (const o of pack.other) {
          console.log(chalk.dim(`    • [${o.memoryType}] ${o.title} — ${o.summary.slice(0, 80)}`));
        }
        console.log();
      }

      if (pack.summaries.length + pack.decisions.length + pack.plans.length + pack.other.length === 0) {
        console.log(chalk.yellow('  No relevant memories found.'));
      }

      vault.close();
    } catch (error) {
      console.error(chalk.red('✗ Recall failed:'), error);
      process.exit(1);
    }
  });

// ============================================================================
// Command: status
// ============================================================================
program
  .command('status')
  .description('Show Vault status and statistics')
  .action(() => {
    try {
      vault.initialize();

      const projects = vault.listProjects();
      const allItems = vault.findMemory({ limit: 100 });
      const logs = vault.getRecentLogs(10);
      const settings = vault.getAllSettings();

      console.log(chalk.bold.green('\n  Vault Status\n'));
      console.log(chalk.dim(`  Root:              ${vault.getVaultRoot()}`));
      console.log(chalk.dim(`  Total Memories:    ${allItems.length}`));
      console.log(chalk.dim(`  Projects:          ${projects.length}`));
      console.log(chalk.dim(`  Enrichment:        ${settings.enrichment_enabled ? 'enabled' : 'disabled'}`));
      console.log();

      if (projects.length > 0) {
        console.log(chalk.bold('  Projects:'));
        for (const p of projects) {
          console.log(chalk.dim(`    • ${p.name} (${p.memoryCount || 0} memories)`));
        }
        console.log();
      }

      if (logs.length > 0) {
        console.log(chalk.bold('  Recent Activity:'));
        for (const log of logs.slice(0, 5)) {
          console.log(chalk.dim(`    ${log.timestamp} | ${log.actionType} | ${log.message || ''}`));
        }
        console.log();
      }

      vault.close();
    } catch (error) {
      console.error(chalk.red('✗ Status check failed:'), error);
      process.exit(1);
    }
  });

program.parse();
