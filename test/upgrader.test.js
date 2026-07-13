import assert from 'node:assert/strict';
import test from 'node:test';
import { getUpgradeStatus } from '../src/upgrader.js';

test('upgrade status reports missing repository configuration', async () => {
  const previousRepo = process.env.UPGRADE_GITHUB_REPO;
  const previousGithubRepo = process.env.GITHUB_REPOSITORY;
  delete process.env.UPGRADE_GITHUB_REPO;
  delete process.env.GITHUB_REPOSITORY;
  try {
    const status = await getUpgradeStatus(process.cwd());
    assert.equal(status.configured, false);
    assert.equal(status.enabled, false);
    assert.match(status.message, /UPGRADE_GITHUB_REPO/);
  } finally {
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
