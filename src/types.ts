/** The two game files that a multiplayer swap is allowed to touch. */

export type SaveFiles = Record<string, Buffer>;

export interface Player {
  character: string;
  steamId: string | null;
  steamName?: string | null;
  hp?: number;
  maxHp?: number;
  gold?: number;
}

export interface RunMetadata {
  act: number;
  ascension: number;
  floor: number | null;
  players: Player[];
  seed: string | null;
  schema: number | null;
}

export interface CloudSnapshot {
  enabled: boolean;
  files: Record<string, string>;
  steamId?: string;
  profileKey?: string;
  customProfile?: boolean;
  names?: Record<string, string>;
}

export interface SaveRecord {
  id: string;
  name?: string;
  notes?: string;
  profile: string;
  metadata?: RunMetadata;
  updated?: string;
  created: string;
  hashes: Record<string, string>;
  hash?: string;
  reason?: string;
  cloud?: {
    steamId: string;
    profileKey: string;
    hashes: Record<string, string>;
  } | null;
}

export interface LibraryIndex {
  version: number;
  profile: string;
  slots: SaveRecord[];
  backups: SaveRecord[];
  loaded: { id: string; profile: string } | null;
  lastCloudSync?: { profile: string; at: string; empty: boolean } | null;
  personaNames?: Record<string, { name: string; updated: string }>;
}

export interface CurrentRun extends Partial<RunMetadata> {
  hash?: string;
  bytes?: number;
  modified?: string;
  invalid?: boolean;
  error?: string;
}

export interface AppState extends LibraryIndex {
  profiles: { path: string; label: string }[];
  current: CurrentRun | null;
  gameRunning: boolean;
  recoveryRequired: boolean;
  libraryPath: string;
  libraryWarnings: string[];
  cloudSupported: boolean;
}

export type Action =
  | 'state'
  | 'configure'
  | 'browse'
  | 'import'
  | 'export'
  | 'openLibrary'
  | 'openProfile'
  | 'launch'
  | 'capture'
  | 'updateSlot'
  | 'load'
  | 'unload'
  | 'restore'
  | 'recover'
  | 'edit'
  | 'remove'
  | 'resolveNames';

export interface CallResult {
  ok: boolean;
  state?: AppState;
  error?: string;
}

export interface DesktopApi {
  call(action: Action, payload?: unknown): Promise<CallResult>;
}

/** A failed remote write may need recovery even if its outcome is unknown. */

export class CloudError extends Error {
  cloudUncertain = false;
}
