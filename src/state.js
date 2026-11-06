import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');
const stateFile = path.join(dataDir, 'state.json');

const DEFAULT_STATE = { announcedReleases: [], announcedIssues: [], lastPoll: null, reactionRolePanelMessageId: null, reactionRoleRoleIds: {} };

export async function loadState() {
  try {
    return { ...DEFAULT_STATE, ...JSON.parse(await fs.readFile(stateFile, 'utf8')) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export async function saveState(state) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(stateFile, JSON.stringify(state, null, 2), 'utf8');
}
