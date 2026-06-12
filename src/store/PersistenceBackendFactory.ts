import { z } from 'zod';
import { SidecarPersistence } from './SidecarPersistence';
import {
  WorkspaceStatePersistence,
  type MementoLike,
} from './WorkspaceStatePersistence';
import { type PersistenceBackend } from './PersistenceBackend';

export const PersistenceBackendKindSchema = z.enum([
  'sidecar',
  'workspaceState',
]);
export type PersistenceBackendKind = z.infer<
  typeof PersistenceBackendKindSchema
>;

export interface PersistenceBackendFactoryDeps {
  memento: MementoLike;
}

export function createPersistenceBackend(
  kind: PersistenceBackendKind | string,
  deps: PersistenceBackendFactoryDeps,
): PersistenceBackend {
  const validated = PersistenceBackendKindSchema.parse(kind);
  switch (validated) {
    case 'sidecar':
      return new SidecarPersistence();
    case 'workspaceState':
      return new WorkspaceStatePersistence(deps.memento);
    default: {
      const _exhaustive: never = validated;
      throw new Error(`알 수 없는 persistence backend: ${String(_exhaustive)}`);
    }
  }
}
