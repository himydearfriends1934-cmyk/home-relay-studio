import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_STATE_FILE } from './constants.js';
import { createDefaultState, normalizeState } from './state.js';

export function resolveStateFile() {
  return path.resolve(DEFAULT_STATE_FILE);
}

export async function loadState() {
  const file = resolveStateFile();
  try {
    const text = await fs.readFile(file, 'utf8');
    return normalizeState(JSON.parse(text));
  } catch {
    const state = createDefaultState();
    await saveState(state);
    return normalizeState(state);
  }
}

export async function saveState(state) {
  const file = resolveStateFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(normalizeState(state), null, 2) + '\n', 'utf8');
}
