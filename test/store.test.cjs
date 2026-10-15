const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store, FILE, NAMES, hash } = require('../src/store.cjs');
const payload = (act) =>
  Buffer.from(
    JSON.stringify({
      acts: [{}, {}],
      current_act_index: act,
      ascension: 4,
      players: [{ character_id: 'CHARACTER.SILENT' }, { character_id: 'CHARACTER.REGENT' }],
      map_point_history: [[], [1, 2]],
    }),
  );
function setup(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spirekeeper-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const saves = path.join(root, 'steam', '123', 'profile1', 'saves');
  fs.mkdirSync(saves, { recursive: true });
  const dataDir = path.join(root, 'library');
  const opts = { dataDir, saveRoot: path.join(root, 'steam'), ...options };
  const store = new Store(opts);
  store.state();
  fs.writeFileSync(path.join(saves, FILE), payload(0));
  fs.writeFileSync(path.join(saves, FILE + '.backup'), payload(0));
  fs.writeFileSync(path.join(saves, 'current_run.save'), 'solo');
  fs.writeFileSync(path.join(saves, 'progress.save'), 'progress');
  return { root, saves, store, opts };
}
test('detect profile, capture, load out, and load back in with exact companion bytes', (t) => {
  const { store, saves } = setup(t);
  assert.equal(store.state().profiles.length, 1);
  const state = store.capture({ name: 'Friday party', notes: 'Hello', unload: true });
  const id = state.slots[0].id;
  assert.equal(fs.existsSync(path.join(saves, FILE)), false);
  assert.equal(state.backups.length, 1);
  store.load(id);
  assert.deepEqual(fs.readFileSync(path.join(saves, FILE)), payload(0));
  assert.deepEqual(fs.readFileSync(path.join(saves, FILE + '.backup')), payload(0));
  assert.equal(fs.readFileSync(path.join(saves, 'current_run.save'), 'utf8'), 'solo');
  assert.equal(fs.readFileSync(path.join(saves, 'progress.save'), 'utf8'), 'progress');
});
test('swap preserves displaced run and restores it', (t) => {
  const { store, saves } = setup(t);
  const id = store.capture({ name: 'A' }).slots[0].id;
  fs.writeFileSync(path.join(saves, FILE), payload(1));
  store.load(id);
  const before = store.db.backups[0];
  store.restore(before.id);
  assert.deepEqual(fs.readFileSync(path.join(saves, FILE)), payload(1));
});
test('partial write failure rolls back both files and keeps recoverable backup', (t) => {
  let fail = false;
  const { store, saves } = setup(t, {
    fault: () => {
      if (fail) throw Error('simulated disk error');
    },
  });
  const id = store.capture({ name: 'A' }).slots[0].id;
  fs.writeFileSync(path.join(saves, FILE), payload(1));
  fail = true;
  assert.throws(() => store.load(id), /Previous save restored/);
  assert.deepEqual(fs.readFileSync(path.join(saves, FILE)), payload(1));
  assert.equal(store.recoveryRequired, false);
});
test('game running rejects all game save mutations', (t) => {
  const { store, saves } = setup(t);
  const id = store.capture({ name: 'A' }).slots[0].id;
  store.isGameRunning = () => true;
  for (const fn of [
    () => store.load(id),
    () => store.unload(),
    () => store.capture({ name: 'B' }),
    () => store.updateSlot(id),
  ])
    assert.throws(fn, /Close Slay/);
  assert.deepEqual(fs.readFileSync(path.join(saves, FILE)), payload(0));
});
test('tampered slot refuses to overwrite active save', (t) => {
  const { store, saves } = setup(t);
  const id = store.capture({ name: 'A' }).slots[0].id;
  fs.writeFileSync(path.join(store.folder('slots', id), FILE), payload(1));
  assert.throws(() => store.load(id), /integrity/);
  assert.deepEqual(fs.readFileSync(path.join(saves, FILE)), payload(0));
});
test('export/import is lossless; malformed and tampered imports rejected', (t) => {
  const { store, root } = setup(t);
  const id = store.capture({ name: 'Friday' }).slots[0].id;
  const dest = path.join(root, 'party.spire');
  store.exportFile(id, dest);
  store.importFile(dest);
  assert.equal(store.db.slots[0].hash, hash(payload(0)));
  assert.equal(store.db.slots[0].name, 'Friday');
  const exportData = JSON.parse(fs.readFileSync(dest));
  exportData.files[FILE] = payload(1).toString('base64');
  fs.writeFileSync(dest, JSON.stringify(exportData));
  assert.throws(() => store.importFile(dest), /checksum/);
  const bad = path.join(root, 'bad.save');
  fs.writeFileSync(bad, '{"players":[]}');
  assert.throws(() => store.importFile(bad), /multiplayer/);
});
test('crash journal restores original pair on next startup', (t) => {
  const { store, saves, opts } = setup(t);
  const b = store.backup('before crash');
  fs.writeFileSync(
    path.join(store.dataDir, 'pending.json'),
    JSON.stringify({ backupId: b.id, profile: saves }),
  );
  fs.writeFileSync(path.join(saves, FILE), payload(1));
  fs.unlinkSync(path.join(saves, FILE + '.backup'));
  const restarted = new Store(opts);
  assert.equal(restarted.recoveryRequired, true);
  assert.throws(() => restarted.unload(), /recovery/i);
  restarted.recover();
  for (const n of NAMES) assert.deepEqual(fs.readFileSync(path.join(saves, n)), payload(0));
});
test('update and remove keep earlier slot files in recoverable trash', (t) => {
  const { store, saves } = setup(t);
  const id = store.capture({ name: 'Friday' }).slots[0].id;
  fs.writeFileSync(path.join(saves, FILE), payload(1));
  store.updateSlot(id);
  assert.equal(store.db.slots.length, 1);
  assert.equal(fs.existsSync(path.join(store.folder('trash', id), FILE)), true);
  const next = store.db.slots[0].id;
  store.remove(next);
  assert.equal(store.db.slots.length, 0);
  assert.equal(fs.existsSync(path.join(store.folder('trash', next), FILE)), true);
});
test('loading a slot without companion removes stale companion safely', (t) => {
  const { store, saves, root } = setup(t);
  const imported = path.join(root, 'external.save');
  fs.writeFileSync(imported, payload(1));
  const id = store.importFile(imported).slots[0].id;
  store.load(id);
  assert.equal(fs.existsSync(path.join(saves, FILE + '.backup')), false);
  assert.equal(Object.keys(store.db.backups[0].hashes).length, 2);
});
test('profile selection and exported filenames cannot redirect writes into library', (t) => {
  const { store, saves } = setup(t);
  const id = store.capture({ name: 'A' }).slots[0].id;
  assert.throws(() => store.load('../../outside'), /not found/);
  assert.throws(() => store.exportFile(id, path.join(saves, FILE)), /Export outside/);
});
test('auto-select the only profile with an active multiplayer save among empty profiles', (t) => {
  const { store, saves, root } = setup(t);
  fs.mkdirSync(path.join(root, 'steam', '123', 'profile2', 'saves'), { recursive: true });
  fs.mkdirSync(path.join(root, 'steam', '123', 'profile3', 'saves'), { recursive: true });
  store.db.profile = '';
  assert.equal(store.state().profile, saves);
});
test('refresh reloads runs and backups created after the app opened', (t) => {
  const { store, opts } = setup(t);
  const stale = new Store(opts);
  store.capture({ name: 'Evan, Daniel', unload: true });
  const actual = stale.state();
  assert.equal(actual.slots.length, 1);
  assert.equal(actual.slots[0].name, 'Evan, Daniel');
  assert.equal(actual.backups.length, 1);
});
test('missing index records are recovered from verified manifests without changing payloads', (t) => {
  const { store, opts } = setup(t);
  store.capture({ name: 'Evan, Daniel', unload: true });
  const before = store.db.slots[0];
  fs.writeFileSync(
    store.indexPath,
    JSON.stringify({ version: 1, profile: store.db.profile, slots: [], backups: [], loaded: null }),
  );
  const reopened = new Store(opts);
  assert.equal(reopened.db.slots[0].name, 'Evan, Daniel');
  assert.equal(reopened.db.backups.length, 1);
  assert.deepEqual(reopened.verify('slots', reopened.db.slots[0])[FILE], payload(0));
  assert.equal(reopened.db.slots[0].id, before.id);
});
test('corrupt library index is preserved and rebuilt from intact save manifests', (t) => {
  const { store, opts } = setup(t);
  store.capture({ name: 'Friday' });
  fs.writeFileSync(store.indexPath, 'broken index');
  const reopened = new Store(opts);
  assert.equal(reopened.db.slots[0].name, 'Friday');
  assert.equal(
    fs.readdirSync(store.dataDir).some((n) => n.startsWith('index.before-recovery-')),
    true,
  );
});
