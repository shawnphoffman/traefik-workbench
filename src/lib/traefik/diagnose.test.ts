import { describe, it, expect } from 'vitest';

import { diagnose, type DiagnoseInput } from './diagnose';
import type {
  TraefikEntryPoint,
  TraefikMiddleware,
  TraefikRouter,
  TraefikService,
} from './types';

function buildInput(overrides: Partial<DiagnoseInput> = {}): DiagnoseInput {
  const empty = { routers: [], services: [], middlewares: [] };
  return {
    http: empty,
    tcp: empty,
    udp: { routers: [], services: [] },
    entryPoints: [],
    ...overrides,
  };
}

function ep(name: string): TraefikEntryPoint {
  return { name, address: ':80' };
}

function router(over: Partial<TraefikRouter> & { name: string }): TraefikRouter {
  return {
    provider: 'file',
    rule: 'Host(`x`)',
    service: 'svc-x',
    entryPoints: ['web'],
    status: 'enabled',
    ...over,
  };
}

function service(
  over: Partial<TraefikService> & { name: string },
): TraefikService {
  return {
    provider: 'file',
    type: 'loadbalancer',
    status: 'enabled',
    ...over,
  };
}

function middleware(
  over: Partial<TraefikMiddleware> & { name: string },
): TraefikMiddleware {
  return {
    provider: 'file',
    type: 'basicauth',
    status: 'enabled',
    ...over,
  };
}

describe('diagnose', () => {
  it('returns no diagnostics for a clean snapshot', () => {
    const result = diagnose(
      buildInput({
        entryPoints: [ep('web')],
        http: {
          routers: [router({ name: 'r1@file', service: 'svc-a@file' })],
          services: [
            service({
              name: 'svc-a@file',
              usedBy: ['r1@file'],
              loadBalancer: {
                servers: [{ url: 'http://10.0.0.1' }],
              },
              serverStatus: { 'http://10.0.0.1': 'UP' },
            }),
          ],
          middlewares: [],
        },
      }),
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.summary).toEqual({ errors: 0, warnings: 0, infos: 0 });
  });

  it('flags routers that point at non-existent services', () => {
    const result = diagnose(
      buildInput({
        entryPoints: [ep('web')],
        http: {
          routers: [
            router({
              name: 'r1@file',
              service: 'missing@file',
            }),
          ],
          services: [],
          middlewares: [],
        },
      }),
    );
    const refs = result.diagnostics.filter((d) => d.category === 'reference');
    expect(refs).toHaveLength(1);
    expect(refs[0].severity).toBe('error');
    expect(refs[0].subject.kind).toBe('router');
    expect(refs[0].message).toContain('missing@file');
  });

  it('flags routers that point at non-existent middlewares', () => {
    const result = diagnose(
      buildInput({
        entryPoints: [ep('web')],
        http: {
          routers: [
            router({
              name: 'r1@file',
              service: 'svc-a@file',
              middlewares: ['ghost@file'],
            }),
          ],
          services: [service({ name: 'svc-a@file', usedBy: ['r1@file'] })],
          middlewares: [],
        },
      }),
    );
    const danglingMiddleware = result.diagnostics.find((d) =>
      d.message.includes('ghost@file'),
    );
    expect(danglingMiddleware?.severity).toBe('error');
    expect(danglingMiddleware?.category).toBe('reference');
  });

  it('matches references with and without provider suffix', () => {
    const result = diagnose(
      buildInput({
        entryPoints: [ep('web')],
        http: {
          // Router refers to bare names, services use suffixed names.
          routers: [
            router({
              name: 'r1@file',
              service: 'svc-a',
              middlewares: ['mw-a'],
            }),
          ],
          services: [
            service({ name: 'svc-a@file', usedBy: ['r1@file'] }),
          ],
          middlewares: [
            middleware({ name: 'mw-a@file', usedBy: ['r1@file'] }),
          ],
        },
      }),
    );
    expect(
      result.diagnostics.filter((d) => d.category === 'reference'),
    ).toEqual([]);
  });

  it('flags routers with no entry points', () => {
    const result = diagnose(
      buildInput({
        entryPoints: [ep('web')],
        http: {
          routers: [
            router({
              name: 'r1@file',
              service: 'svc-a@file',
              entryPoints: [],
            }),
          ],
          services: [service({ name: 'svc-a@file', usedBy: ['r1@file'] })],
          middlewares: [],
        },
      }),
    );
    const noEntry = result.diagnostics.find((d) =>
      d.message.includes('no entry points'),
    );
    expect(noEntry?.severity).toBe('warning');
  });

  it('flags routers with unknown entry points', () => {
    const result = diagnose(
      buildInput({
        entryPoints: [ep('web')],
        http: {
          routers: [
            router({
              name: 'r1@file',
              service: 'svc-a@file',
              entryPoints: ['nope'],
            }),
          ],
          services: [service({ name: 'svc-a@file', usedBy: ['r1@file'] })],
          middlewares: [],
        },
      }),
    );
    const bad = result.diagnostics.find((d) => d.message.includes('"nope"'));
    expect(bad?.severity).toBe('error');
    expect(bad?.category).toBe('reference');
  });

  it('flags duplicate rules on the same entry point as a conflict', () => {
    const result = diagnose(
      buildInput({
        entryPoints: [ep('web')],
        http: {
          routers: [
            router({
              name: 'a@file',
              service: 'svc-a@file',
              rule: 'Host(`x`)',
            }),
            router({
              name: 'b@file',
              service: 'svc-a@file',
              rule: 'Host(`x`)',
            }),
          ],
          services: [service({ name: 'svc-a@file', usedBy: ['a@file', 'b@file'] })],
          middlewares: [],
        },
      }),
    );
    const conflict = result.diagnostics.find(
      (d) => d.category === 'conflict',
    );
    expect(conflict?.severity).toBe('warning');
    expect(conflict?.message).toContain('a@file');
    expect(conflict?.message).toContain('b@file');
  });

  it('does not flag duplicate rules on different entry points', () => {
    const result = diagnose(
      buildInput({
        entryPoints: [ep('web'), ep('websecure')],
        http: {
          routers: [
            router({
              name: 'a@file',
              service: 'svc@file',
              entryPoints: ['web'],
              rule: 'Host(`x`)',
            }),
            router({
              name: 'b@file',
              service: 'svc@file',
              entryPoints: ['websecure'],
              rule: 'Host(`x`)',
            }),
          ],
          services: [service({ name: 'svc@file', usedBy: ['a@file', 'b@file'] })],
          middlewares: [],
        },
      }),
    );
    expect(
      result.diagnostics.filter((d) => d.category === 'conflict'),
    ).toEqual([]);
  });

  it('flags servers reported DOWN', () => {
    const result = diagnose(
      buildInput({
        entryPoints: [ep('web')],
        http: {
          routers: [router({ name: 'r1@file', service: 'svc-a@file' })],
          services: [
            service({
              name: 'svc-a@file',
              usedBy: ['r1@file'],
              loadBalancer: {
                servers: [
                  { url: 'http://10.0.0.1' },
                  { url: 'http://10.0.0.2' },
                ],
              },
              serverStatus: {
                'http://10.0.0.1': 'UP',
                'http://10.0.0.2': 'DOWN',
              },
            }),
          ],
          middlewares: [],
        },
      }),
    );
    const down = result.diagnostics.find((d) => d.category === 'health');
    expect(down?.severity).toBe('warning');
    expect(down?.message).toContain('10.0.0.2');
    expect(down?.message).toContain('DOWN');
  });

  it('flags orphan services and middlewares', () => {
    const result = diagnose(
      buildInput({
        entryPoints: [ep('web')],
        http: {
          routers: [],
          services: [
            service({
              name: 'unused@file',
              loadBalancer: { servers: [{ url: 'http://10.0.0.1' }] },
            }),
          ],
          middlewares: [middleware({ name: 'unused-mw@file' })],
        },
      }),
    );
    const orphans = result.diagnostics.filter((d) => d.category === 'orphan');
    expect(orphans).toHaveLength(2);
    expect(orphans.every((o) => o.severity === 'info')).toBe(true);
  });

  it('does not flag internal items as orphans', () => {
    const result = diagnose(
      buildInput({
        entryPoints: [ep('traefik')],
        http: {
          routers: [],
          services: [
            service({
              name: 'api@internal',
              provider: 'internal',
            }),
            service({
              name: 'noop@internal',
              provider: 'internal',
            }),
          ],
          middlewares: [
            middleware({
              name: 'dashboard_redirect@internal',
              provider: 'internal',
            }),
          ],
        },
      }),
    );
    expect(
      result.diagnostics.filter((d) => d.category === 'orphan'),
    ).toEqual([]);
  });

  it('passes through Traefik error[] strings on disabled items', () => {
    const result = diagnose(
      buildInput({
        entryPoints: [ep('web')],
        http: {
          routers: [
            router({
              name: 'broken@file',
              status: 'disabled',
              error: ['middleware "ghost@file" does not exist'],
            }),
          ],
          services: [],
          middlewares: [],
        },
      }),
    );
    const status = result.diagnostics.find((d) => d.category === 'status');
    expect(status?.severity).toBe('error');
    expect(status?.message).toBe('middleware "ghost@file" does not exist');
  });

  it('sorts errors before warnings before infos', () => {
    const result = diagnose(
      buildInput({
        entryPoints: [ep('web')],
        http: {
          routers: [
            router({
              name: 'broken@file',
              service: 'missing@file',
            }),
            router({
              name: 'warned@file',
              service: 'svc@file',
              entryPoints: [],
            }),
          ],
          services: [
            service({
              name: 'svc@file',
              usedBy: ['warned@file'],
            }),
            service({ name: 'orphan@file' }),
          ],
          middlewares: [],
        },
      }),
    );
    const seen = result.diagnostics.map((d) => d.severity);
    const errIdx = seen.indexOf('error');
    const warnIdx = seen.indexOf('warning');
    const infoIdx = seen.indexOf('info');
    expect(errIdx).toBeLessThan(warnIdx);
    expect(warnIdx).toBeLessThan(infoIdx);
  });

  it('counts each severity in the summary', () => {
    const result = diagnose(
      buildInput({
        entryPoints: [ep('web')],
        http: {
          routers: [
            router({ name: 'r1@file', service: 'missing@file' }), // error
            router({ name: 'r2@file', service: 'svc@file', entryPoints: [] }), // warning
          ],
          services: [
            service({ name: 'svc@file', usedBy: ['r2@file'] }),
            service({ name: 'orphan@file' }), // info
          ],
          middlewares: [],
        },
      }),
    );
    expect(result.summary.errors).toBeGreaterThanOrEqual(1);
    expect(result.summary.warnings).toBeGreaterThanOrEqual(1);
    expect(result.summary.infos).toBeGreaterThanOrEqual(1);
    const sum =
      result.summary.errors + result.summary.warnings + result.summary.infos;
    expect(sum).toBe(result.diagnostics.length);
  });
});
