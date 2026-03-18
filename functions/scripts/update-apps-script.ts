#!/usr/bin/env npx tsx
/**
 * Updates the deployed Apps Script web app with the latest code.
 * Reads the script ID and deployment ID from gdocs-script-id.json,
 * pushes the updated code, creates a new version, and updates the deployment.
 *
 * Usage: npx tsx scripts/update-apps-script.ts
 */

import { google } from 'googleapis';
import * as fs from 'fs';
import { APPS_SCRIPT_CODE, APPS_SCRIPT_MANIFEST } from './apps-script-source';
import {
  TOKEN_PATH, SCRIPT_CONFIG_PATH,
  getAuthClient, handleScriptError,
} from './oauth-helpers';

async function main() {
  if (!fs.existsSync(SCRIPT_CONFIG_PATH)) {
    console.error('No script config found. Run setup-apps-script.ts first.');
    process.exit(1);
  }
  if (!fs.existsSync(TOKEN_PATH)) {
    console.error('No OAuth token found. Run setup-apps-script.ts first to authorize.');
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(SCRIPT_CONFIG_PATH, 'utf-8'));
  const { scriptId, webAppDeploymentId } = config;
  console.log(`Updating script ${scriptId}...`);

  const oauth2Client = await getAuthClient();
  const script = google.script({ version: 'v1', auth: oauth2Client });

  // Step 1: Update code
  console.log('Pushing updated code...');
  await script.projects.updateContent({
    scriptId,
    requestBody: {
      files: [
        {
          name: 'Code',
          type: 'SERVER_JS',
          source: APPS_SCRIPT_CODE,
        },
        {
          name: 'appsscript',
          type: 'JSON',
          source: JSON.stringify(APPS_SCRIPT_MANIFEST),
        },
      ],
    },
  });

  // Step 2: Create a new version
  const newVersion = (config.versionNumber || 6) + 1;
  console.log(`Creating version ${newVersion}...`);
  const versionRes = await script.projects.versions.create({
    scriptId,
    requestBody: {
      description: `v${newVersion}: Preserve paragraph indentation, spacing, list markers`,
    },
  });
  const actualVersion = versionRes.data.versionNumber!;
  console.log(`Created version ${actualVersion}`);

  // Step 3: Try to update the web app deployment
  if (webAppDeploymentId) {
    console.log(`Updating deployment ${webAppDeploymentId} to version ${actualVersion}...`);
    try {
      await script.projects.deployments.update({
        scriptId,
        deploymentId: webAppDeploymentId,
        requestBody: {
          deploymentConfig: {
            versionNumber: actualVersion,
            description: `v${actualVersion}: Preserve formatting`,
          },
        },
      });
      console.log('Deployment updated successfully!');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Could not update deployment via API: ${msg}`);
      console.log('\nTo update manually:');
      console.log(`1. Open: https://script.google.com/home/projects/${scriptId}/deployments`);
      console.log('2. Click the pencil icon on the web app deployment');
      console.log(`3. Change version to ${actualVersion}`);
      console.log('4. Click Deploy');
    }
  }

  // Save updated config
  config.versionNumber = actualVersion;
  fs.writeFileSync(SCRIPT_CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log(`\nConfig updated. Version: ${actualVersion}`);
}

main().catch(handleScriptError);
