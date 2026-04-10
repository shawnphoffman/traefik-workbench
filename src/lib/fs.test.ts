import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  readTextFile,
  writeTextFile,
  createFile,
  createDirectory,
  deleteEntry,
  listDirectory,
  listDirectoryTree,
  listTemplateFiles,
  copyFile,
  renameEntry,
  FsError,
} from './fs';

let root: string;

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'tw-fs-test-'));
});

afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

describe('readTextFile', () => {
  it('reads a file as UTF-8', async () => {
    const p = path.join(root, 'a.yml');
    await fsp.writeFile(p, 'hello: world\n');
    expect(await readTextFile(p)).toBe('hello: world\n');
  });

  it('throws NOT_FOUND for a missing file', async () => {
    await expect(readTextFile(path.join(root, 'missing.yml'))).rejects.toEqual(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });

  it('throws NOT_A_FILE when given a directory', async () => {
    await expect(readTextFile(root)).rejects.toEqual(
      expect.objectContaining({ code: 'NOT_A_FILE' }),
    );
  });
});

describe('writeTextFile', () => {
  it('overwrites an existing file atomically', async () => {
    const p = path.join(root, 'a.yml');
    await fsp.writeFile(p, 'old');
    await writeTextFile(p, 'new');
    expect(await fsp.readFile(p, 'utf8')).toBe('new');
  });

  it('does not leave temp files behind on success', async () => {
    const p = path.join(root, 'a.yml');
    await fsp.writeFile(p, 'old');
    await writeTextFile(p, 'new');
    const remaining = await fsp.readdir(root);
    expect(remaining).toEqual(['a.yml']);
  });

  it('throws NOT_FOUND when the file does not exist', async () => {
    await expect(
      writeTextFile(path.join(root, 'new.yml'), 'content'),
    ).rejects.toEqual(expect.objectContaining({ code: 'NOT_FOUND' }));
  });
});

describe('createFile', () => {
  it('creates a new file', async () => {
    const p = path.join(root, 'a.yml');
    await createFile(p, 'hello');
    expect(await fsp.readFile(p, 'utf8')).toBe('hello');
  });

  it('defaults to empty content', async () => {
    const p = path.join(root, 'a.yml');
    await createFile(p);
    expect(await fsp.readFile(p, 'utf8')).toBe('');
  });

  it('throws ALREADY_EXISTS if the file exists', async () => {
    const p = path.join(root, 'a.yml');
    await fsp.writeFile(p, 'existing');
    await expect(createFile(p, 'new')).rejects.toEqual(
      expect.objectContaining({ code: 'ALREADY_EXISTS' }),
    );
    // Original untouched.
    expect(await fsp.readFile(p, 'utf8')).toBe('existing');
  });

  it('throws NOT_FOUND if the parent directory is missing', async () => {
    await expect(
      createFile(path.join(root, 'missing', 'a.yml'), 'x'),
    ).rejects.toEqual(expect.objectContaining({ code: 'NOT_FOUND' }));
  });
});

describe('createDirectory', () => {
  it('creates a new directory', async () => {
    const p = path.join(root, 'sub');
    await createDirectory(p);
    const stat = await fsp.stat(p);
    expect(stat.isDirectory()).toBe(true);
  });

  it('throws ALREADY_EXISTS if the directory exists', async () => {
    const p = path.join(root, 'sub');
    await fsp.mkdir(p);
    await expect(createDirectory(p)).rejects.toEqual(
      expect.objectContaining({ code: 'ALREADY_EXISTS' }),
    );
  });
});

describe('deleteEntry', () => {
  it('deletes a file', async () => {
    const p = path.join(root, 'a.yml');
    await fsp.writeFile(p, 'x');
    await deleteEntry(p);
    await expect(fsp.stat(p)).rejects.toThrow();
  });

  it('deletes a directory recursively', async () => {
    const dir = path.join(root, 'sub');
    await fsp.mkdir(dir);
    await fsp.writeFile(path.join(dir, 'a.yml'), 'x');
    await deleteEntry(dir);
    await expect(fsp.stat(dir)).rejects.toThrow();
  });

  it('throws NOT_FOUND when deleting a missing path', async () => {
    await expect(deleteEntry(path.join(root, 'missing'))).rejects.toEqual(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });
});

describe('listDirectory', () => {
  it('lists immediate children with folders first', async () => {
    await fsp.writeFile(path.join(root, 'a.yml'), 'x');
    await fsp.writeFile(path.join(root, 'b.yml'), 'xx');
    await fsp.mkdir(path.join(root, 'zdir'));
    const entries = await listDirectory(root, root);
    expect(entries.map((e) => e.name)).toEqual(['zdir', 'a.yml', 'b.yml']);
    expect(entries[0]).toEqual({
      name: 'zdir',
      path: 'zdir',
      kind: 'directory',
    });
    expect(entries[1]).toEqual({
      name: 'a.yml',
      path: 'a.yml',
      kind: 'file',
      size: 1,
    });
  });

  it('returns an empty array for an empty directory', async () => {
    expect(await listDirectory(root, root)).toEqual([]);
  });

  it('throws NOT_FOUND for a missing directory', async () => {
    await expect(
      listDirectory(root, path.join(root, 'missing')),
    ).rejects.toEqual(expect.objectContaining({ code: 'NOT_FOUND' }));
  });
});

describe('listDirectoryTree', () => {
  it('recursively lists nested directories', async () => {
    await fsp.mkdir(path.join(root, 'routers'));
    await fsp.writeFile(path.join(root, 'routers', 'web.yml'), 'x');
    await fsp.writeFile(path.join(root, 'top.yml'), 'yy');

    const tree = await listDirectoryTree(root, root);
    expect(tree).toEqual([
      {
        name: 'routers',
        path: 'routers',
        kind: 'directory',
        children: [
          {
            name: 'web.yml',
            path: 'routers/web.yml',
            kind: 'file',
            size: 1,
          },
        ],
      },
      {
        name: 'top.yml',
        path: 'top.yml',
        kind: 'file',
        size: 2,
      },
    ]);
  });

  it('respects maxDepth', async () => {
    await fsp.mkdir(path.join(root, 'a'));
    await fsp.mkdir(path.join(root, 'a', 'b'));
    await fsp.writeFile(path.join(root, 'a', 'b', 'deep.yml'), 'x');

    const tree = await listDirectoryTree(root, root, 1);
    expect(tree).toHaveLength(1);
    // At depth 0 we list root -> 'a'; 'a' is at depth 1 which is NOT
    // less than maxDepth=1, so its children are truncated.
    expect(tree[0]).toEqual({
      name: 'a',
      path: 'a',
      kind: 'directory',
      children: [],
    });
  });
});

describe('listTemplateFiles', () => {
  it('lists only .yml/.yaml files, recursively', async () => {
    await fsp.writeFile(path.join(root, 'router.yml'), 'x');
    await fsp.writeFile(path.join(root, 'readme.md'), 'skip');
    await fsp.mkdir(path.join(root, 'sub'));
    await fsp.writeFile(path.join(root, 'sub', 'service.yaml'), 'x');

    const templates = await listTemplateFiles(root);
    expect(templates).toEqual([
      { name: 'router.yml', path: 'router.yml' },
      { name: 'service.yaml', path: 'sub/service.yaml' },
    ]);
  });
});

describe('copyFile', () => {
  it('copies a file to a new location', async () => {
    const src = path.join(root, 'src.yml');
    const dst = path.join(root, 'dst.yml');
    await fsp.writeFile(src, 'hello');
    await copyFile(src, dst);
    expect(await fsp.readFile(dst, 'utf8')).toBe('hello');
  });

  it('throws ALREADY_EXISTS if the destination exists', async () => {
    const src = path.join(root, 'src.yml');
    const dst = path.join(root, 'dst.yml');
    await fsp.writeFile(src, 'new');
    await fsp.writeFile(dst, 'existing');
    await expect(copyFile(src, dst)).rejects.toEqual(
      expect.objectContaining({ code: 'ALREADY_EXISTS' }),
    );
    // Destination untouched.
    expect(await fsp.readFile(dst, 'utf8')).toBe('existing');
  });

  it('throws NOT_FOUND when the source is missing', async () => {
    await expect(
      copyFile(path.join(root, 'missing.yml'), path.join(root, 'dst.yml')),
    ).rejects.toEqual(expect.objectContaining({ code: 'NOT_FOUND' }));
  });
});

describe('renameEntry', () => {
  it('renames a file in place', async () => {
    const src = path.join(root, 'old.yml');
    const dst = path.join(root, 'new.yml');
    await fsp.writeFile(src, 'hello');
    await renameEntry(src, dst);
    expect(await fsp.readFile(dst, 'utf8')).toBe('hello');
    await expect(fsp.stat(src)).rejects.toThrow();
  });

  it('moves a file into another existing directory', async () => {
    const src = path.join(root, 'a.yml');
    await fsp.writeFile(src, 'hi');
    await fsp.mkdir(path.join(root, 'sub'));
    const dst = path.join(root, 'sub', 'a.yml');
    await renameEntry(src, dst);
    expect(await fsp.readFile(dst, 'utf8')).toBe('hi');
  });

  it('renames a directory recursively', async () => {
    const src = path.join(root, 'old');
    await fsp.mkdir(src);
    await fsp.writeFile(path.join(src, 'inner.yml'), 'x');
    const dst = path.join(root, 'new');
    await renameEntry(src, dst);
    expect(await fsp.readFile(path.join(dst, 'inner.yml'), 'utf8')).toBe('x');
    await expect(fsp.stat(src)).rejects.toThrow();
  });

  it('no-ops when source and destination are equal', async () => {
    const p = path.join(root, 'a.yml');
    await fsp.writeFile(p, 'x');
    await renameEntry(p, p);
    expect(await fsp.readFile(p, 'utf8')).toBe('x');
  });

  it('throws NOT_FOUND when the source is missing', async () => {
    await expect(
      renameEntry(path.join(root, 'missing.yml'), path.join(root, 'a.yml')),
    ).rejects.toEqual(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  it('throws ALREADY_EXISTS when the destination exists', async () => {
    const src = path.join(root, 'a.yml');
    const dst = path.join(root, 'b.yml');
    await fsp.writeFile(src, 'src');
    await fsp.writeFile(dst, 'dst');
    await expect(renameEntry(src, dst)).rejects.toEqual(
      expect.objectContaining({ code: 'ALREADY_EXISTS' }),
    );
    // Neither side modified.
    expect(await fsp.readFile(src, 'utf8')).toBe('src');
    expect(await fsp.readFile(dst, 'utf8')).toBe('dst');
  });

  it('throws NOT_FOUND when the destination parent directory is missing', async () => {
    const src = path.join(root, 'a.yml');
    await fsp.writeFile(src, 'x');
    await expect(
      renameEntry(src, path.join(root, 'missing', 'a.yml')),
    ).rejects.toEqual(expect.objectContaining({ code: 'NOT_FOUND' }));
    // Source untouched.
    expect(await fsp.readFile(src, 'utf8')).toBe('x');
  });
});

describe('FsError', () => {
  it('preserves the code on instances', () => {
    const err = new FsError('test', 'NOT_FOUND');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(FsError);
    expect(err.code).toBe('NOT_FOUND');
  });
});
