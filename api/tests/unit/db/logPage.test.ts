import { createTestDb, createSampleLog } from '../../helpers/testDb';
import { LogRepository } from '../../../src/db/logRepository';
import { InvalidCursor } from '../../../src/db/logPageReader';
describe('cursor pages and idempotent delivery', () => {
  let resource: ReturnType<typeof createTestDb>, repo: LogRepository;
  beforeEach(() => {
    resource = createTestDb();
    repo = new LogRepository(resource.db);
  });
  afterEach(() => resource.cleanup());
  it('does not lose timestamp ties or repeat events when new logs arrive between pages', () => {
    const timestamp = '2026-11-04T10:00:00.000Z';
    repo.insertBatch(
      Array.from({ length: 60 }, (_, i) => createSampleLog({ id: String(i), timestamp })),
    );
    const first = repo.searchPage({ limit: 25 });
    repo.insert(createSampleLog({ id: 'new', timestamp: '2026-11-04T11:00:00Z' }));
    const second = repo.searchPage({ limit: 25, cursor: first.nextCursor! }),
      third = repo.searchPage({ limit: 25, cursor: second.nextCursor! });
    const ids = [...first.logs, ...second.logs, ...third.logs].map((log) => log.id);
    expect(ids).toHaveLength(60);
    expect(new Set(ids).size).toBe(60);
    expect(ids).not.toContain('new');
    expect(third.hasMore).toBe(false);
  });
  it('binds cursors to the actual filters and rejects malformed positions', () => {
    repo.insertBatch(Array.from({ length: 3 }, () => createSampleLog({ source: 'auth' })));
    const page = repo.searchPage({ source: 'auth', limit: 1 });
    expect(() => repo.searchPage({ source: 'payments', cursor: page.nextCursor! })).toThrow(
      InvalidCursor,
    );
    expect(() => repo.searchPage({ cursor: 'not-json' })).toThrow(InvalidCursor);
  });
  it('uses the global FTS fallback for rare, older phrases and retains literal phrase semantics', () => {
    repo.insert(
      createSampleLog({
        id: 'rare',
        message: 'connection timeout',
        timestamp: '2020-01-01T00:00:00Z',
      }),
    );
    repo.insertBatch(
      Array.from({ length: 10200 }, (_, i) =>
        createSampleLog({ id: 'normal-' + i, message: 'request completed' }),
      ),
    );
    expect(repo.searchPage({ q: 'connection timeout' }).logs.map((log) => log.id)).toEqual([
      'rare',
    ]);
    expect(repo.searchPage({ q: '" OR "' }).logs).toEqual([]);
  });
  it('commits a replayed delivery only once without updating the original row or FTS content', () => {
    const log = createSampleLog({ id: 'same', message: 'original timeout' });
    resource.db.transaction(() => repo.insertDeliveredBatch([log, log]))();
    resource.db.transaction(() =>
      repo.insertDeliveredBatch([{ ...log, message: 'modified replay' }]),
    )();
    expect(repo.count()).toBe(1);
    expect(repo.getById('same')?.message).toBe('original timeout');
    expect(repo.searchPage({ q: 'original timeout' }).logs).toHaveLength(1);
    expect(repo.searchPage({ q: 'modified replay' }).logs).toHaveLength(0);
  });
});
