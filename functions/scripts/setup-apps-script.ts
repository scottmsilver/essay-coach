#!/usr/bin/env npx tsx
/**
 * Creates and deploys an Apps Script project for bookmark extraction.
 * Only needs to run once. Saves the deployment ID for fetch-gdoc.ts to use.
 *
 * Usage: npx tsx scripts/setup-apps-script.ts
 */

import { google } from 'googleapis';
import * as fs from 'fs';
import * as http from 'http';
import {
  TOKEN_PATH, SCRIPT_CONFIG_PATH, REDIRECT_PORT, REDIRECT_URI,
  loadOAuthClient, handleScriptError,
} from './oauth-helpers';

const SCOPES = [
  'https://www.googleapis.com/auth/documents.readonly',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/script.projects',
  'https://www.googleapis.com/auth/script.deployments',
];

const GCP_PROJECT_NUMBER = '284674585096';

import { APPS_SCRIPT_CODE, APPS_SCRIPT_MANIFEST } from './apps-script-source';

async function authorize(oauth2Client: InstanceType<typeof google.auth.OAuth2>): Promise<void> {
  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    oauth2Client.setCredentials(token);
    if (token.expiry_date && token.expiry_date < Date.now() && token.refresh_token) {
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(credentials);
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(credentials, null, 2));
    }
    return;
  }

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log('\nOpen this URL in your browser to authorize:\n');
  console.log(authUrl);
  console.log('\nWaiting for authorization...');

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost:${REDIRECT_PORT}`);
      const code = url.searchParams.get('code');
      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Authorized! You can close this tab.</h1>');
        server.close();
        resolve(code);
      } else {
        res.writeHead(400);
        res.end('Missing code parameter');
        server.close();
        reject(new Error('No authorization code received'));
      }
    });
    server.listen(REDIRECT_PORT);
  });

  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  console.log('Token cached.');
}

async function main() {
  const oauth2Client = loadOAuthClient();
  await authorize(oauth2Client);

  const script = google.script({ version: 'v1', auth: oauth2Client });

  // Check if we already have a script project
  if (fs.existsSync(SCRIPT_CONFIG_PATH)) {
    const config = JSON.parse(fs.readFileSync(SCRIPT_CONFIG_PATH, 'utf-8'));
    console.log(`Apps Script project already exists: ${config.scriptId}`);
    console.log(`Deployment ID: ${config.deploymentId}`);
    console.log('\nTo re-create, delete gdocs-script-id.json and run again.');
    return;
  }

  console.log('\nCreating Apps Script project...');

  // Create the project
  const createRes = await script.projects.create({
    requestBody: {
      title: 'Essay Grader - Doc Reader',
    },
  });

  const scriptId = createRes.data.scriptId!;
  console.log(`Script ID: ${scriptId}`);

  // Update the project content
  console.log('Uploading script code...');
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

  // Create a version first (required before deployment)
  console.log('Creating version...');
  const versionRes = await script.projects.versions.create({
    scriptId,
    requestBody: {
      description: 'Initial version',
    },
  });

  const versionNumber = versionRes.data.versionNumber!;
  console.log(`Version: ${versionNumber}`);

  // Now create an API executable deployment with the version
  console.log('Creating API executable deployment...');
  const deploy2Res = await script.projects.deployments.create({
    scriptId,
    requestBody: {
      versionNumber,
      description: 'API executable for essay grader',
    },
  });

  const deploymentId = deploy2Res.data.deploymentId!;
  console.log(`Deployment ID: ${deploymentId}`);

  // Save config
  const config = { scriptId, webAppDeploymentId: deploymentId, versionNumber };
  fs.writeFileSync(SCRIPT_CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log(`\nConfig saved to ${SCRIPT_CONFIG_PATH}`);

  console.log('\n--- IMPORTANT ---');
  console.log('You need to set the GCP project number for the Apps Script:');
  console.log(`1. Open: https://script.google.com/home/projects/${scriptId}/settings`);
  console.log(`2. Under "Google Cloud Platform (GCP) Project", click "Change project"`);
  console.log(`3. Enter project number: ${GCP_PROJECT_NUMBER}`);
  console.log('4. Click "Set project"');
  console.log('\nThis links the Apps Script to your Firebase project so OAuth works.');
}

main().catch(handleScriptError);
