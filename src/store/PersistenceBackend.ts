import { type Comment } from '../model/Comment';

export type PersistenceBackendName = 'sidecar' | 'workspaceState';

export interface PersistenceBackend {
  readonly backendName: PersistenceBackendName;
  load(docUri: string): Promise<Comment[]>;
  save(docUri: string, comments: readonly Comment[]): Promise<void>;
}
