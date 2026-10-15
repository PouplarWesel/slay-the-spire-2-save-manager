const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spirekeeper-ui-'));
  const saveRoot = path.join(root, 'steam'),
    saves = path.join(saveRoot, '123456789', 'profile1', 'saves');
  fs.mkdirSync(saves, { recursive: true });
  const bytes = JSON.stringify({
    acts: [{}, {}],
    current_act_index: 1,
    ascension: 6,
    players: [
      { character_id: 'CHARACTER.NECROBINDER' },
      { character_id: 'CHARACTER.SILENT' },
      { character_id: 'CHARACTER.REGENT' },
    ],
    map_point_history: [[1, 2], [3]],
  });
  const active = path.join(saves, 'current_run_mp.save');
  fs.writeFileSync(active, bytes);
  fs.writeFileSync(active + '.backup', bytes);
  const env = {
    ...process.env,
    SPIREKEEPER_DATA_DIR: path.join(root, 'library'),
    SPIREKEEPER_SAVE_ROOT: saveRoot,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({
      args: process.env.SPIREKEEPER_EXECUTABLE ? [] : [path.resolve(__dirname, '..')],
      executablePath: process.env.SPIREKEEPER_EXECUTABLE || undefined,
      env,
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.getByText('Current run', { exact: true }).waitFor();
    await page.locator('#capture').click();
    await page.locator('#name').fill('Friday night crew');
    await page.locator('#notes').fill('Three friends, one climb.');
    await page.locator('#alternateSubmit').click();
    await page.getByText('No active multiplayer run', { exact: true }).waitFor();
    assert.equal(fs.existsSync(active), false);
    await page.locator('#load').click();
    await page.locator('#modalSubmit').click();
    await page.getByText('Current run - Friday night crew', { exact: true }).waitFor();
    assert.equal(fs.readFileSync(active, 'utf8'), bytes);
    assert.equal(fs.readFileSync(active + '.backup', 'utf8'), bytes);
    await page.locator('#search').fill('missing');
    await page.getByText('No matching saves.').waitFor();
    await page.locator('#search').fill('');
    await page.locator('#edit').click();
    await page.locator('#name').fill('The midnight party');
    await page.locator('#modalSubmit').click();
    await page.getByText('Current run - The midnight party', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-backup]').count(), 2);
    await page.locator('summary').click();
    await page
      .getByText(
        'Load in/out updates the selected profile’s local and Steam Cloud multiplayer files.',
        { exact: false },
      )
      .waitFor();
    await page.locator('summary').click();
    const output = path.resolve(__dirname, '../artifacts');
    fs.mkdirSync(output, { recursive: true });
    await page.waitForFunction(() =>
      document.getAnimations().every((a) => a.playState === 'finished'),
    );
    await page.screenshot({ path: path.join(output, 'app-preview.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log(
      'UI smoke passed: capture, load out, load in, rename, search, recovery history, settings, no renderer errors.',
    );
  } finally {
    if (app) await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
