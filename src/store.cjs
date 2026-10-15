const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const FILE = 'current_run_mp.save';
const NAMES = [FILE, FILE + '.backup'];
const MAX = 32 * 1024 * 1024;
const hash = (b) => createHash('sha256').update(b).digest('hex');
const cloudEncode = (files) =>
  Object.fromEntries(Object.entries(files).map(([n, b]) => [n, b.toString('base64')]));
const cloudSame = (a, b) => NAMES.every((n) => (a.files[n] ?? null) === (b.files[n] ?? null));
function safePath(p) {
  let cur = path.resolve(p);
  for (;;) {
    if (fs.existsSync(cur) && fs.lstatSync(cur).isSymbolicLink())
      throw new Error('Symbolic links and junctions are not supported: ' + cur);
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return path.resolve(p);
}
function atomic(p, bytes) {
  safePath(p);
  const temp = p + '.' + randomUUID() + '.tmp';
  try {
    const fd = fs.openSync(temp, 'wx');
    try {
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temp, p);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
function readBytes(p, max = MAX) {
  safePath(p);
  const s = fs.statSync(p);
  if (!s.isFile() || s.size > max) throw new Error('Save file exceeds the supported size limit.');
  return fs.readFileSync(p);
}
function metadata(bytes) {
  let j;
  try {
    j = JSON.parse(
      bytes
        .toString('utf8')
        .replace(/^\uFEFF/, '')
        .replace(/("net_id"\s*:\s*)(\d+)/g, '$1"$2"'),
    );
  } catch {
    throw new Error('This is not a readable JSON save file.');
  }
  if (
    !j ||
    !Array.isArray(j.players) ||
    j.players.length < 2 ||
    j.players.length > 64 ||
    !Array.isArray(j.acts) ||
    !Number.isInteger(j.current_act_index) ||
    !j.players.every((p) => p && typeof p.character_id === 'string')
  )
    throw new Error(
      'This does not look like a multiplayer run save. Select current_run_mp.save from the host’s profile.',
    );
  return {
    act: j.current_act_index + 1,
    ascension: j.ascension ?? 0,
    floor: Array.isArray(j.map_point_history) ? j.map_point_history.flat().length : null,
    players: j.players.map((p) => ({
      character: p.character_id.replace(/^CHARACTER\./, ''),
      steamId: /^7656119\d{10}$/.test(String(p.net_id)) ? String(p.net_id) : null,
      hp: p.current_hp,
      maxHp: p.max_hp,
      gold: p.gold,
    })),
    seed: j.rng?.seed ?? null,
    schema: j.schema_version ?? null,
  };
}
function text(v, max) {
  return String(v ?? '')
    .trim()
    .slice(0, max);
}
class Store {
  constructor({ dataDir, saveRoot, isGameRunning = () => false, fault = () => {}, cloud = null }) {
    this.dataDir = safePath(dataDir);
    this.saveRoot = saveRoot;
    this.isGameRunning = isGameRunning;
    this.fault = fault;
    this.cloud = cloud;
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.indexPath = safePath(path.join(this.dataDir, 'index.json'));
    this.db = { version: 1, profile: '', slots: [], backups: [], loaded: null };
    this.libraryWarnings = [];
    for (const d of ['slots', 'backups', 'trash'])
      fs.mkdirSync(path.join(this.dataDir, d), { recursive: true });
    this.recoveryRequired = fs.existsSync(path.join(this.dataDir, 'pending.json'));
    this.refresh();
  }
  refresh() {
    const existed = fs.existsSync(this.indexPath);
    let damaged = false;
    this.libraryWarnings = [];
    if (existed) {
      try {
        const latest = JSON.parse(readBytes(this.indexPath).toString('utf8'));
        if (latest.version !== 1 || !Array.isArray(latest.slots) || !Array.isArray(latest.backups))
          throw new Error('Invalid library index.');
        this.db = latest;
      } catch (e) {
        damaged = true;
        this.libraryWarnings.push('Library index needs recovery: ' + e.message);
      }
    }
    let recovered = 0;
    let migrated = false;
    for (const slot of this.db.slots)
      if (slot.metadata?.players?.some((p) => !Object.hasOwn(p, 'steamId'))) {
        try {
          slot.metadata = metadata(this.verify('slots', slot)[FILE]);
          migrated = true;
        } catch (e) {
          this.libraryWarnings.push('Could not read roster for ' + slot.name + ': ' + e.message);
        }
      }
    for (const type of ['slots', 'backups']) {
      const known = new Set(this.db[type].map((r) => r.id));
      for (const entry of fs.readdirSync(path.join(this.dataDir, type), { withFileTypes: true })) {
        if (
          !entry.isDirectory() ||
          entry.isSymbolicLink() ||
          !/^[a-f0-9-]{36}$/.test(entry.name) ||
          known.has(entry.name)
        )
          continue;
        try {
          const manifest = JSON.parse(
            readBytes(path.join(this.folder(type, entry.name), 'manifest.json')).toString('utf8'),
          );
          if (
            manifest.id !== entry.name ||
            !manifest.hashes ||
            typeof manifest.created !== 'string'
          )
            throw new Error('Invalid manifest.');
          const files = this.verify(type, manifest);
          if (type === 'slots') {
            if (!files[FILE]) throw new Error('Saved run payload is missing.');
            manifest.metadata = metadata(files[FILE]);
            manifest.name = text(manifest.name, 100) || 'Recovered run';
            manifest.notes = text(manifest.notes, 2000);
            manifest.updated ||= manifest.created;
            manifest.hash = hash(files[FILE]);
          } else if (manifest.cloud) this.cloudBackup(manifest);
          this.db[type].push(manifest);
          known.add(manifest.id);
          recovered++;
        } catch (e) {
          this.libraryWarnings.push(
            'Could not recover ' + type + '/' + entry.name + ': ' + e.message,
          );
        }
      }
      this.db[type].sort((a, b) =>
        String(b.updated || b.created).localeCompare(String(a.updated || a.created)),
      );
    }
    if (damaged && !recovered)
      throw new Error(
        'The library index could not be read. Your save files have not been changed.',
      );
    if (recovered || damaged || migrated) {
      if (existed)
        fs.copyFileSync(
          this.indexPath,
          safePath(path.join(this.dataDir, 'index.before-recovery-' + randomUUID() + '.json')),
        );
      this.persist();
    }
    this.recoveryRequired = fs.existsSync(path.join(this.dataDir, 'pending.json'));
    return recovered;
  }
  persist() {
    atomic(this.indexPath, JSON.stringify(this.db, null, 2));
  }
  profiles() {
    const found = [];
    const walk = (dir, depth) => {
      if (depth > 5 || !fs.existsSync(dir)) return;
      safePath(dir);
      if (
        path.basename(dir) === 'saves' &&
        /^profile\d+$/i.test(path.basename(path.dirname(dir)))
      ) {
        found.push({
          path: dir,
          label: path.relative(this.saveRoot, path.dirname(dir)).replace(/\\/g, ' / '),
        });
        return;
      }
      for (const e of fs.readdirSync(dir, { withFileTypes: true }))
        if (e.isDirectory() && !e.isSymbolicLink()) walk(path.join(dir, e.name), depth + 1);
    };
    walk(this.saveRoot, 0);
    return found;
  }
  configure(dir) {
    if (this.recoveryRequired)
      throw new Error('Recover the interrupted swap before changing profiles.');
    dir = safePath(dir);
    if (path.basename(dir) !== 'saves' || !fs.statSync(dir).isDirectory())
      throw new Error('Choose the profile’s saves folder.');
    if (path.relative(this.dataDir, dir).split(path.sep)[0] !== '..')
      throw new Error('The library cannot also be your game save folder.');
    this.db.profile = dir;
    this.db.loaded = null;
    this.persist();
    return this.state();
  }
  profile() {
    if (!this.db.profile) throw new Error('Choose a game profile first.');
    return safePath(this.db.profile);
  }
  pair(dir) {
    const out = {};
    for (const n of NAMES) {
      const p = path.join(dir, n);
      if (fs.existsSync(p)) out[n] = readBytes(p);
    }
    return out;
  }
  current() {
    if (!this.db.profile) return null;
    const p = path.join(this.profile(), FILE);
    if (!fs.existsSync(p)) return null;
    try {
      const b = readBytes(p);
      return {
        ...metadata(b),
        hash: hash(b),
        bytes: b.length,
        modified: fs.statSync(p).mtime.toISOString(),
      };
    } catch (e) {
      return { invalid: true, error: e.message };
    }
  }
  state() {
    this.refresh();
    const profiles = this.profiles();
    const activeProfiles = profiles.filter((p) => fs.existsSync(path.join(p.path, FILE)));
    if (!this.db.profile && (profiles.length === 1 || activeProfiles.length === 1)) {
      this.db.profile = (activeProfiles[0] || profiles[0]).path;
      this.persist();
    }
    const names = this.db.personaNames || {};
    const withNames = (m) =>
      m
        ? {
            ...m,
            players: (m.players || []).map((p) => ({
              ...p,
              steamName: names[p.steamId]?.name || null,
            })),
          }
        : m;
    const current = this.current();
    return {
      ...this.db,
      slots: this.db.slots.map((s) => ({ ...s, metadata: withNames(s.metadata) })),
      profiles,
      current: current?.invalid ? current : withNames(current),
      gameRunning: this.isGameRunning(),
      recoveryRequired: this.recoveryRequired,
      libraryPath: this.dataDir,
      libraryWarnings: this.libraryWarnings,
      cloudSupported: Boolean(this.cloud?.context?.(this.db.profile || '')),
    };
  }
  resolveNames() {
    if (!this.cloud?.names) throw new Error('Steam name lookup is unavailable.');
    const ids = [
      ...new Set(
        [...this.db.slots.flatMap((s) => s.metadata.players), ...(this.current()?.players || [])]
          .map((p) => p.steamId)
          .filter(Boolean),
      ),
    ];
    if (!ids.length) return this.state();
    const profile = this.cloud.context?.(this.db.profile || '')
      ? this.db.profile
      : this.db.slots.find((s) => this.cloud.context?.(s.profile || ''))?.profile;
    if (!profile) throw new Error('Choose the Steam profile for this run first.');
    const found = this.cloud.names(profile, ids.slice(0, 64));
    this.db.personaNames ||= {};
    for (const [id, name] of Object.entries(found))
      if (ids.includes(id) && typeof name === 'string' && name.trim())
        this.db.personaNames[id] = {
          name: name.trim().slice(0, 256),
          updated: new Date().toISOString(),
        };
    this.persist();
    return this.state();
  }
  guard() {
    this.profile();
    if (this.recoveryRequired)
      throw new Error('An interrupted swap needs recovery. Use Recover interrupted swap first.');
    if (this.isGameRunning()) throw new Error('Close Slay the Spire 2 before changing saves.');
  }
  slot(id) {
    const s = this.db.slots.find((s) => s.id === id);
    if (!s) throw new Error('Save slot not found.');
    return s;
  }
  folder(type, id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid library ID.');
    return safePath(path.join(this.dataDir, type, id));
  }
  writeBundle(type, files, info) {
    const id = randomUUID(),
      dir = this.folder(type, id);
    fs.mkdirSync(dir);
    for (const [n, b] of Object.entries(files)) {
      if (!NAMES.includes(n)) throw new Error('Unexpected save filename.');
      atomic(path.join(dir, n), b);
    }
    const result = {
      id,
      ...info,
      created: new Date().toISOString(),
      hashes: Object.fromEntries(Object.entries(files).map(([n, b]) => [n, hash(b)])),
    };
    atomic(path.join(dir, 'manifest.json'), JSON.stringify(result, null, 2));
    return result;
  }
  verify(type, record) {
    const files = this.pair(this.folder(type, record.id));
    for (const n of NAMES)
      if ((record.hashes[n] || null) !== (files[n] ? hash(files[n]) : null))
        throw new Error('Save integrity check failed. Original files have not been replaced.');
    return files;
  }
  backup(reason, cloudBefore = null) {
    const cloudInfo = cloudBefore?.enabled
      ? {
          steamId: cloudBefore.steamId,
          profileKey: cloudBefore.profileKey,
          hashes: Object.fromEntries(
            Object.entries(cloudBefore.files).map(([n, b]) => [n, hash(Buffer.from(b, 'base64'))]),
          ),
        }
      : null;
    const b = this.writeBundle('backups', this.pair(this.profile()), {
      reason,
      profile: this.db.profile,
      cloud: cloudInfo,
    });
    if (cloudInfo)
      atomic(
        path.join(this.folder('backups', b.id), 'steam-cloud.json'),
        JSON.stringify(cloudBefore),
      );
    this.db.backups.unshift(b);
    this.persist();
    return b;
  }
  cloudBackup(b) {
    const snapshot = JSON.parse(
      readBytes(path.join(this.folder('backups', b.id), 'steam-cloud.json'), MAX * 3).toString(
        'utf8',
      ),
    );
    if (
      !snapshot.enabled ||
      snapshot.steamId !== b.cloud.steamId ||
      snapshot.profileKey !== b.cloud.profileKey ||
      !snapshot.files
    )
      throw new Error('Invalid Steam recovery backup.');
    for (const [n, v] of Object.entries(snapshot.files))
      if (!NAMES.includes(n) || typeof v !== 'string')
        throw new Error('Invalid Steam recovery file.');
    for (const n of NAMES)
      if (
        (b.cloud.hashes[n] ?? null) !==
        (snapshot.files[n] ? hash(Buffer.from(snapshot.files[n], 'base64')) : null)
      )
        throw new Error('Steam recovery backup checksum failed.');
    return snapshot;
  }
  capture({ name, notes = '', unload = false }) {
    this.guard();
    name = text(name, 100);
    if (!name) throw new Error('Give this campaign a name.');
    const files = this.pair(this.profile());
    if (!files[FILE]) throw new Error('There is no active multiplayer run to save.');
    const s = this.writeBundle('slots', files, {
      name,
      notes: text(notes, 2000),
      profile: this.db.profile,
      metadata: metadata(files[FILE]),
      updated: new Date().toISOString(),
      hash: hash(files[FILE]),
    });
    this.db.slots.unshift(s);
    this.persist();
    if (unload) this.swap({}, 'Loaded out: ' + name, null);
    else {
      this.db.loaded = { id: s.id, profile: this.db.profile };
      this.persist();
    }
    return this.state();
  }
  updateSlot(id) {
    this.guard();
    const old = this.slot(id);
    const files = this.pair(this.profile());
    if (!files[FILE]) throw new Error('No active run to update from.');
    const next = this.writeBundle('slots', files, {
      name: old.name,
      notes: old.notes,
      profile: this.db.profile,
      metadata: metadata(files[FILE]),
      updated: new Date().toISOString(),
      hash: hash(files[FILE]),
    });
    this.db.slots.unshift(next);
    this.db.slots = this.db.slots.filter((s) => s.id !== old.id);
    this.db.loaded = { id: next.id, profile: this.db.profile };
    this.persist();
    fs.renameSync(this.folder('slots', old.id), this.folder('trash', old.id));
    return this.state();
  }
  apply(files) {
    const dir = this.profile();
    for (const n of NAMES) {
      const p = safePath(path.join(dir, n));
      if (files[n]) atomic(p, files[n]);
      else if (fs.existsSync(p)) fs.unlinkSync(p);
      this.fault(n);
    }
  }
  swap(files, reason, loaded) {
    this.guard();
    const cloudBefore = this.cloud ? this.cloud.read(this.db.profile) : null;
    this.guard();
    const backup = this.backup(reason, cloudBefore),
      pending = path.join(this.dataDir, 'pending.json');
    atomic(pending, JSON.stringify({ backupId: backup.id, profile: this.db.profile }));
    const previous = this.db.loaded;
    let cloudApplied = false;
    try {
      if (cloudBefore?.enabled) {
        this.cloud.apply(this.db.profile, files, cloudBefore);
        cloudApplied = true;
      }
      this.guard();
      this.apply(files);
      this.db.loaded = loaded;
      this.db.lastCloudSync = cloudApplied
        ? { profile: this.db.profile, at: new Date().toISOString(), empty: !files[FILE] }
        : null;
      this.persist();
      fs.unlinkSync(pending);
    } catch (e) {
      try {
        if (cloudBefore?.enabled && (cloudApplied || e.cloudUncertain)) {
          const actual = this.cloud.read(this.db.profile);
          if (!actual.enabled) throw new Error('Steam Cloud was disabled during rollback.');
          if (!cloudSame(actual, cloudBefore)) {
            if (!cloudSame(actual, { files: cloudEncode(files) }))
              throw new Error('Steam Cloud changed during rollback.');
            this.cloud.apply(
              this.db.profile,
              Object.fromEntries(
                Object.entries(cloudBefore.files).map(([n, b]) => [n, Buffer.from(b, 'base64')]),
              ),
              actual,
            );
          }
        }
        const savedFault = this.fault;
        this.fault = () => {};
        try {
          this.apply(this.verify('backups', backup));
        } finally {
          this.fault = savedFault;
        }
        this.db.loaded = previous;
        this.persist();
        fs.unlinkSync(pending);
      } catch {
        this.recoveryRequired = true;
      }
      throw new Error(
        'Swap failed. ' +
          (this.recoveryRequired ? 'Recovery is required.' : 'Previous save restored.') +
          ' ' +
          e.message,
      );
    }
  }
  load(id) {
    const s = this.slot(id);
    const files = this.verify('slots', s);
    metadata(files[FILE]);
    this.swap(files, 'Before loading: ' + s.name, { id, profile: this.db.profile });
    return this.state();
  }
  unload() {
    this.guard();
    if (!Object.keys(this.pair(this.profile())).length)
      throw new Error('No multiplayer save to load out.');
    this.swap({}, 'Loaded out active run', null);
    return this.state();
  }
  restore(id) {
    const b = this.db.backups.find((b) => b.id === id);
    if (!b) throw new Error('Backup not found.');
    if (b.profile !== this.db.profile)
      throw new Error('Select the backup’s original game profile first.');
    this.swap(this.verify('backups', b), 'Before restoring backup', null);
    return this.state();
  }
  recover() {
    if (this.isGameRunning()) throw new Error('Close the game before recovering.');
    const p = path.join(this.dataDir, 'pending.json'),
      j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const b = this.db.backups.find((b) => b.id === j.backupId);
    if (!b || b.profile !== j.profile) throw new Error('Recovery backup is missing.');
    this.db.profile = safePath(j.profile);
    const localFiles = this.verify('backups', b);
    if (b.cloud) {
      if (!this.cloud) throw new Error('Steam Cloud support is needed to recover this swap.');
      const before = this.cloudBackup(b),
        actual = this.cloud.read(this.db.profile);
      if (!actual.enabled)
        throw new Error(
          'Steam Cloud settings changed. Enable Cloud for this game before recovering this swap.',
        );
      this.backup('Before interrupted-swap recovery', actual);
      if (!cloudSame(before, actual))
        this.cloud.apply(
          this.db.profile,
          Object.fromEntries(
            Object.entries(before.files).map(([n, v]) => [n, Buffer.from(v, 'base64')]),
          ),
          actual,
        );
    }
    this.apply(localFiles);
    this.db.loaded = null;
    this.persist();
    fs.unlinkSync(p);
    this.recoveryRequired = false;
    return this.state();
  }
  edit({ id, name, notes }) {
    const s = this.slot(id);
    name = text(name, 100);
    if (!name) throw new Error('Name cannot be empty.');
    s.name = name;
    s.notes = text(notes, 2000);
    this.persist();
    return this.state();
  }
  remove(id) {
    const s = this.slot(id);
    fs.renameSync(this.folder('slots', s.id), this.folder('trash', s.id));
    this.db.slots = this.db.slots.filter((x) => x.id !== id);
    if (this.db.loaded?.id === id) this.db.loaded = null;
    this.persist();
    return this.state();
  }
  importFile(p) {
    const bytes = readBytes(p, path.extname(p).toLowerCase() === '.spire' ? MAX * 3 : MAX);
    let files = { [FILE]: bytes },
      name = path.basename(p).replace(/\.(save|spire)$/, '');
    if (path.extname(p).toLowerCase() === '.spire') {
      let j;
      try {
        j = JSON.parse(bytes);
      } catch {
        throw new Error('Invalid Spirekeeper export.');
      }
      if (j.format !== 'spirekeeper-1' || !j.files || typeof j.files[FILE] !== 'string')
        throw new Error('Invalid Spirekeeper export.');
      files = {};
      for (const n of NAMES)
        if (j.files[n]) {
          if (typeof j.files[n] !== 'string') throw new Error('Invalid save payload.');
          files[n] = Buffer.from(j.files[n], 'base64');
          if (files[n].length > MAX) throw new Error('Imported save exceeds 32 MB.');
          if (hash(files[n]) !== j.hashes?.[n])
            throw new Error('Imported save checksum does not match.');
        }
      name = text(j.name, 100) || name;
    } else if (fs.existsSync(p + '.backup')) files[FILE + '.backup'] = readBytes(p + '.backup');
    const s = this.writeBundle('slots', files, {
      name: text(name, 100) || 'Imported campaign',
      notes: '',
      metadata: metadata(files[FILE]),
      updated: new Date().toISOString(),
      hash: hash(files[FILE]),
      profile: '',
    });
    this.db.slots.unshift(s);
    this.persist();
    return this.state();
  }
  exportFile(id, dest) {
    const s = this.slot(id),
      files = this.verify('slots', s);
    const target = safePath(dest);
    if (
      target.toLowerCase().startsWith(this.dataDir.toLowerCase() + path.sep) ||
      (this.db.profile && target.toLowerCase().startsWith(this.profile().toLowerCase() + path.sep))
    )
      throw new Error('Export outside the game save folder and app library.');
    atomic(
      target,
      JSON.stringify({
        format: 'spirekeeper-1',
        name: s.name,
        hashes: s.hashes,
        files: Object.fromEntries(Object.entries(files).map(([n, b]) => [n, b.toString('base64')])),
      }),
    );
    return this.state();
  }
}
module.exports = { Store, metadata, FILE, NAMES, hash };
