const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store, FILE, NAMES, hash } = require('../src/store.cjs');
const { SteamCloud, encode, same } = require('../src/steam-cloud.cjs');
const payload = (act) =>
  Buffer.from(
    JSON.stringify({
      acts: [{}, {}],
      current_act_index: act,
      ascension: 0,
      players: [{ character_id: 'CHARACTER.SILENT' }, { character_id: 'CHARACTER.REGENT' }],
    }),
  );
function setup(t, extras = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spire-cloud-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const saves = path.join(root, 'steam', '123', 'profile1', 'saves');
  fs.mkdirSync(saves, { recursive: true });
  const remote = {
    enabled: true,
    steamId: '76561198959815944',
    profileKey: 'profile1/saves',
    files: encode({ [FILE]: payload(1) }),
  };
  const cloud = {
    context: () => ({}),
    read: () => structuredClone(remote),
    apply: (profile, files, expected) => {
      assert.equal(same(remote, expected), true);
      remote.files = encode(files);
      return structuredClone(remote);
    },
  };
  const options = {
    dataDir: path.join(root, 'library'),
    saveRoot: path.join(root, 'steam'),
    cloud,
    ...extras,
  };
  const store = new Store(options);
  store.state();
  for (const n of NAMES) fs.writeFileSync(path.join(saves, n), payload(0));
  return { root, saves, remote, cloud, store, options };
}
test('load out clears cloud and local copies; recovery preserves each original independently', (t) => {
  const { store, remote, saves } = setup(t);
  store.unload();
  assert.deepEqual(remote.files, {});
  assert.equal(fs.existsSync(path.join(saves, FILE)), false);
  const backup = store.db.backups[0];
  assert.equal(backup.cloud.hashes[FILE], hash(payload(1)));
  const cloudBackup = store.cloudBackup(backup);
  assert.equal(cloudBackup.files[FILE], payload(1).toString('base64'));
  assert.deepEqual(store.verify('backups', backup)[FILE], payload(0));
});
test('load in writes exact slot bytes to cloud and local and removes stale cloud backup', (t) => {
  const { store, remote, saves, root } = setup(t);
  const imported = path.join(root, 'party.save');
  fs.writeFileSync(imported, payload(0));
  const id = store.importFile(imported).slots[0].id;
  remote.files[FILE + '.backup'] = payload(1).toString('base64');
  store.load(id);
  assert.deepEqual(remote.files, encode({ [FILE]: payload(0) }));
  assert.deepEqual(fs.readFileSync(path.join(saves, FILE)), payload(0));
  assert.equal(fs.existsSync(path.join(saves, FILE + '.backup')), false);
});
test('local disk failure after cloud swap restores cloud and local to their separate originals', (t) => {
  let fail = false;
  const { store, remote, saves } = setup(t, {
    fault: () => {
      if (fail) throw Error('disk unavailable');
    },
  });
  fail = true;
  assert.throws(() => store.unload(), /Previous save restored/);
  assert.deepEqual(remote.files, encode({ [FILE]: payload(1) }));
  for (const n of NAMES) assert.deepEqual(fs.readFileSync(path.join(saves, n)), payload(0));
  assert.equal(store.recoveryRequired, false);
});
test('cloud refusal never removes local saves', (t) => {
  const { store, cloud, saves } = setup(t);
  cloud.apply = () => {
    throw Error('Steam rejected delete');
  };
  assert.throws(() => store.unload(), /Previous save restored/);
  assert.deepEqual(fs.readFileSync(path.join(saves, FILE)), payload(0));
});
test('uncertain cloud failure retains crash journal and original cloud backup', (t) => {
  const { store, cloud, remote, options, saves } = setup(t);
  cloud.apply = () => {
    remote.files = { [FILE]: payload(8).toString('base64') };
    const e = Error('Lost Steam connection');
    e.cloudUncertain = true;
    throw e;
  };
  assert.throws(() => store.unload(), /Recovery is required/);
  assert.equal(store.recoveryRequired, true);
  assert.deepEqual(fs.readFileSync(path.join(saves, FILE)), payload(0));
  cloud.apply = (p, files, expected) => {
    assert.equal(same(remote, expected), true);
    remote.files = encode(files);
  };
  const restarted = new Store(options);
  restarted.recover();
  assert.deepEqual(remote.files, encode({ [FILE]: payload(1) }));
  assert.equal(restarted.recoveryRequired, false);
  assert.equal(restarted.db.backups.length, 2);
});
test('crash after successful cloud swap restores cloud backup at next startup', (t) => {
  const { store, remote, options } = setup(t);
  const b = store.backup('before interrupted swap', store.cloud.read());
  fs.writeFileSync(
    path.join(store.dataDir, 'pending.json'),
    JSON.stringify({ backupId: b.id, profile: store.db.profile }),
  );
  remote.files = {};
  const restarted = new Store(options);
  restarted.recover();
  assert.deepEqual(remote.files, encode({ [FILE]: payload(1) }));
});
test('cloud disabled leaves cloud files alone but permits local swap', (t) => {
  const { store, remote, saves } = setup(t);
  remote.enabled = false;
  store.unload();
  assert.equal(fs.existsSync(path.join(saves, FILE)), false);
  assert.equal(remote.files[FILE], payload(1).toString('base64'));
});
test('cloud backup checksum fails before any recovery write', (t) => {
  const { store, remote, options } = setup(t);
  const b = store.backup('test', store.cloud.read());
  const saved = store.cloudBackup(b);
  saved.files[FILE] = payload(9).toString('base64');
  fs.writeFileSync(
    path.join(store.folder('backups', b.id), 'steam-cloud.json'),
    JSON.stringify(saved),
  );
  fs.writeFileSync(
    path.join(store.dataDir, 'pending.json'),
    JSON.stringify({ backupId: b.id, profile: store.db.profile }),
  );
  const restarted = new Store(options);
  assert.throws(() => restarted.recover(), /checksum/);
  assert.equal(remote.files[FILE], payload(1).toString('base64'));
});
test('Steam adapter maps only exact standard vanilla/modded multiplayer profiles', () => {
  const cloud = new SteamCloud();
  assert.deepEqual(
    cloud.context(
      'C:/Users/realp/AppData/Roaming/SlayTheSpire2/steam/76561198959815944/modded/profile2/saves',
    ),
    { steamId: '76561198959815944', profileKey: 'modded/profile2/saves' },
  );
  assert.equal(cloud.context('C:/Users/realp/Documents/random/saves'), null);
});
test('Steam adapter rejects helper account mismatch and uncertain errors', () => {
  const profile =
    'C:/Users/realp/AppData/Roaming/SlayTheSpire2/steam/76561198959815944/profile1/saves';
  const fake = new SteamCloud({
    dllPath: __filename,
    invoke: () =>
      'SPIREKEEPER_RESULT=' +
      JSON.stringify({ ok: true, enabled: true, steamId: '76561198959815945', files: {} }),
  });
  assert.throws(() => fake.read(profile), /account/);
  fake.invoke = () =>
    'SPIREKEEPER_RESULT=' +
    JSON.stringify({ ok: false, error: 'rollback failed', needsRecovery: true });
  assert.throws(
    () =>
      fake.apply(
        profile,
        {},
        { steamId: '76561198959815944', profileKey: 'profile1/saves', files: {} },
      ),
    (e) => e.cloudUncertain === true,
  );
});
