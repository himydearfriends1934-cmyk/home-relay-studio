import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getUpgradeStatus } from '../src/upgrader.js';

test('upgrade status reports missing repository configuration', async () => {
  const previousRepo = process.env.UPGRADE_GITHUB_REPO;
  const previousGithubRepo = process.env.GITHUB_REPOSITORY;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'home-relay-upgrade-test-'));
  delete process.env.UPGRADE_GITHUB_REPO;
  delete process.env.GITHUB_REPOSITORY;
  try {
    const status = await getUpgradeStatus(tempRoot);
    assert.equal(status.configured, false);
    assert.equal(status.enabled, false);
    assert.match(status.message, /UPGRADE_GITHUB_REPO|origin remote/);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
    if (previousRepo === undefined) {
      delete process.env.UPGRADE_GITHUB_REPO;
    } else {
      process.env.UPGRADE_GITHUB_REPO = previousRepo;
    }
    if (previousGithubRepo === undefined) {
      delete process.env.GITHUB_REPOSITORY;
    } else {
      process.env.GITHUB_REPOSITORY = previousGithubRepo;
    }
  }
});
