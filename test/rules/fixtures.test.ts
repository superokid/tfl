import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mapStatus } from '../../src/shared/rules/status';

const fixture = (name: string) => JSON.parse(readFileSync(`test/fixtures/${name}.json`, 'utf8')).body;

describe('live fixtures', () => {
  it('every rail severity TfL publishes maps to an expectation', () => {
    const rail = /tube|dlr|overground|elizabeth|tram|cable/;
    const descriptions: string[] = fixture('severity')
      .filter((s: { modeName: string }) => rail.test(s.modeName))
      .map((s: { description: string }) => s.description);
    expect(descriptions.length).toBeGreaterThan(10);
    expect(descriptions.filter((d) => mapStatus(d) === null)).toEqual([]);
  });

  it('no fixture contains a key', () => {
    for (const name of ['status-rail', 'arr-victoria-oxford-circus', 'tt-victoria-brixton']) {
      expect(readFileSync(`test/fixtures/${name}.json`, 'utf8')).not.toMatch(/app_key=(?!REDACTED)/);
    }
  });
});
