#!/usr/bin/env npx tsx
/**
 * Deploys the current APPS_SCRIPT_CODE as a NEW, SEPARATE web-app deployment
 * (the "candidate"), leaving the production deployment pinned to its existing
 * version. Used for the before/after equivalence gate — see
 * docs/superpowers/plans/2026-07-07-gdoc-accept-suggestions.md Task 7.
 *
 * Versioned Apps Script deployments serve their pinned version, so pushing
 * new HEAD content does not affect the prod deployment.
 *
 * Usage: npx tsx scripts/deploy-secondary-gdoc-script.ts
 * Prints the candidate deployment ID (NEW_DEPLOYMENT_ID for the harness)
 * and stores it in gdocs-script-id.json as candidateDeploymentId.
 */

import { google } from 'googleapis';
import * as fs from 'fs';
import { APPS_SCRIPT_CODE, APPS_SCRIPT_MANIFEST } from './apps-script-source';
import {
  TOKEN_PATH, SCRIPT_CONFIG_PATH,
  getAuthClient, handleScriptError,
} from './oauth-helpers';

async function main() {
  if (!fs.existsSync(SCRIPT_CONFIG_PATH) || !fs.existsSync(TOKEN_PATH)) {
    console.error('Missing script config or OAuth token. Run setup-apps-script.ts first.');
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(SCRIPT_CONFIG_PATH, 'utf-8'));
  const { scriptId, webAppDeploymentId } = config;
  console.log(`Script: ${scriptId}`);
  console.log(`Prod deployment (untouched): ${webAppDeploymentId} @ v${config.versionNumber}`);

  const oauth2Client = await getAuthClient();
  const script = google.script({ version: 'v1', auth: oauth2Client });

  console.log('Pushing new code to HEAD (prod deployment stays on its pinned version)...');
  await script.projects.updateContent({
    scriptId,
    requestBody: {
      files: [
        { name: 'Code', type: 'SERVER_JS', source: APPS_SCRIPT_CODE },
        { name: 'appsscript', type: 'JSON', source: JSON.stringify(APPS_SCRIPT_MANIFEST) },
      ],
    },
  });

  const versionRes = await script.projects.versions.create({
    scriptId,
    requestBody: { description: 'Docs advanced service builder + suggestions param (candidate)' },
  });
  const version = versionRes.data.versionNumber!;
  console.log(`Created version ${version}`);

  let candidateId: string;
  let entryPoints;
  if (config.candidateDeploymentId) {
    candidateId = config.candidateDeploymentId;
    console.log(`Updating existing candidate deployment ${candidateId} to v${version}...`);
    const depRes = await script.projects.deployments.update({
      scriptId,
      deploymentId: candidateId,
      requestBody: {
        deploymentConfig: {
          versionNumber: version,
          manifestFileName: 'appsscript',
          description: `candidate v${version}: Docs API formatter`,
        },
      },
    });
    entryPoints = depRes.data.entryPoints;
  } else {
    console.log('Creating candidate deployment...');
    const depRes = await script.projects.deployments.create({
      scriptId,
      requestBody: {
        versionNumber: version,
        manifestFileName: 'appsscript',
        description: `candidate v${version}: Docs API formatter`,
      },
    });
    candidateId = depRes.data.deploymentId!;
    entryPoints = depRes.data.entryPoints;
  }
  const webAppEntry = (entryPoints || []).find((e) => e.entryPointType === 'WEB_APP');

  config.candidateDeploymentId = candidateId;
  config.candidateVersionNumber = version;
  fs.writeFileSync(SCRIPT_CONFIG_PATH, JSON.stringify(config, null, 2));

  console.log('\n=== CANDIDATE DEPLOYMENT READY ===');
  console.log(`NEW_DEPLOYMENT_ID=${candidateId}`);
  console.log(`OLD_DEPLOYMENT_ID=${webAppDeploymentId}`);
  if (webAppEntry?.webApp?.url) console.log(`Web app URL: ${webAppEntry.webApp.url}`);
  console.log('\nNext: run the harness —');
  console.log(`  OLD_DEPLOYMENT_ID=${webAppDeploymentId} NEW_DEPLOYMENT_ID=${candidateId} npx tsx scripts/verify-gdoc-formatter.ts`);
}

main().catch(handleScriptError);
