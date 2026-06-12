import { expect } from 'chai';
import {
  createPersistenceBackend,
  PersistenceBackendKindSchema,
} from '../../src/store/PersistenceBackendFactory';
import { SidecarPersistence } from '../../src/store/SidecarPersistence';
import { WorkspaceStatePersistence } from '../../src/store/WorkspaceStatePersistence';

const noopMemento = {
  get<T>(_key: string): T | undefined {
    return undefined;
  },
  async update(_key: string, _value: unknown): Promise<void> {
    /* noop */
  },
};

describe('PersistenceBackendFactory — mutually exclusive selection', () => {
  it('sidecar kind returns SidecarPersistence', () => {
    const b = createPersistenceBackend('sidecar', { memento: noopMemento });
    expect(b).to.be.instanceOf(SidecarPersistence);
    expect(b.backendName).to.equal('sidecar');
  });

  it('workspaceState kind returns WorkspaceStatePersistence', () => {
    const b = createPersistenceBackend('workspaceState', {
      memento: noopMemento,
    });
    expect(b).to.be.instanceOf(WorkspaceStatePersistence);
    expect(b.backendName).to.equal('workspaceState');
  });

  it('PersistenceBackendFactory — invalid kind throws ZodError', () => {
    expect(() =>
      createPersistenceBackend('both', { memento: noopMemento }),
    ).to.throw();
    expect(() =>
      createPersistenceBackend('', { memento: noopMemento }),
    ).to.throw();
    expect(() =>
      createPersistenceBackend('auto', { memento: noopMemento }),
    ).to.throw();
  });

  it('PersistenceBackendKindSchema parses only the two allowed enum values', () => {
    expect(PersistenceBackendKindSchema.parse('sidecar')).to.equal('sidecar');
    expect(PersistenceBackendKindSchema.parse('workspaceState')).to.equal(
      'workspaceState',
    );
    expect(() => PersistenceBackendKindSchema.parse('sqlite')).to.throw();
  });
});
