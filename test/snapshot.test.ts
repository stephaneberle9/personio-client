import { describe, expect, it } from 'vitest';
import {
  toSnapshotRecord,
  toSnapshot,
} from '../examples/lib/model/snapshotData.js';
import type { AttendanceDisplayRecord } from '../examples/lib/model/displayRecords.js';

const records: AttendanceDisplayRecord[] = [
  {
    date: '2026-06-01', employee: 'Schmidt, Anna', customer: 'Acme', costCenter: '50101 Alten GmbH',
    project: 'Parent Program', subProject: 'Website Relaunch', hours: 7.5, comment: 'Did stuff',
    projectStart: '2026-01-01', projectEnd: '2026-12-31',
  },
];

describe('snapshot', () => {
  it('maps an English attendance display record to the German SnapshotRecord', () => {
    expect(toSnapshotRecord(records[0]!)).toEqual({
      datum: '2026-06-01',
      ma: 'Schmidt, Anna',
      kunde: 'Acme',
      kst: '50101 Alten GmbH',
      projekt: 'Parent Program',
      up: 'Website Relaunch',
      std: 7.5,
      kommentar: 'Did stuff',
      startdatum: '2026-01-01',
      enddatum: '2026-12-31',
    });
  });

  it('localizes records and stamps the audit meta block', () => {
    const snapshot = toSnapshot(records, { from: '2026-06-01', to: '2026-06-30', source: 'api' });
    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.records[0]!.datum).toBe('2026-06-01');
    expect(snapshot.meta).toMatchObject({
      from: '2026-06-01', to: '2026-06-30', source: 'api', reportId: null, count: 1,
    });
    // generatedAt is a valid ISO timestamp.
    expect(Number.isNaN(Date.parse(snapshot.meta.generatedAt))).toBe(false);
  });

  it('records the reportId only for a report source, nulling a leftover on api', () => {
    const onApi = toSnapshot(records, {
      from: '2026-06-01', to: '2026-06-30', source: 'api', reportId: 'leftover-report-id',
    });
    expect(onApi.meta.reportId).toBeNull();

    const onReport = toSnapshot(records, {
      from: '2026-06-01', to: '2026-06-30', source: 'report', reportId: 'r1',
    });
    expect(onReport.meta.reportId).toBe('r1');
  });
});
