// Generate the npm packages (a loader + one package per platform) for the aiany
// fork of sqlite-vec, replacing sqlite-dist's npm target.
//
// Why not sqlite-dist: sqlite-dist writes each npm tarball at
// `.sqlite-dist/npm/<pkg-name>.tar.gz` with a bare `File::create` and only
// `create_dir` (single level) for the output dir — so a scoped name like
// `@aiany/sqlite-vec-windows-arm64` (whose `/` makes a nested path) crashes the
// build. We only need npm, so we generate it ourselves and `mkdir -p` freely,
// which lets us use the @aiany scope. The emitted loader/index.* and per-platform
// package shape is kept faithful to sqlite-dist's npm output so consumers can
// switch back to upstream `sqlite-vec` by name alone.
//
// Usage: VERSION=$(cat VERSION) node scripts/pack-npm.mjs
// Input:  dist/<os>-<arch>/vec0.<ext>   (downloaded build artifacts)
// Output: npm-out/@aiany/<pkg>/         (publish-ready package directories)

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE_PACKAGE_NAME = '@aiany/sqlite-vec'
const ENTRYPOINT_BASE_NAME = 'vec0'
const REPO = 'https://github.com/aianyai/sqlite-vec'
const AUTHOR = 'Alex Garcia'
const LICENSE = 'MIT OR Apache-2.0'
const DESCRIPTION = 'A vector search SQLite extension (aiany fork, adds windows-arm64).'
const VERSION = (process.env.VERSION || readFileSync('VERSION', 'utf8')).trim()

const OUT = 'npm-out'
const LICENSE_FILES = ['LICENSE-MIT', 'LICENSE-APACHE']

// dist/<dir> -> npm metadata. `pkgOs` names the package (npm convention is
// "windows"), while `osField` is the package.json "os" value (npm uses "win32").
const PLATFORMS = [
  { dir: 'linux-x86_64', pkgOs: 'linux', osField: 'linux', cpu: 'x64', suffix: 'so' },
  { dir: 'linux-aarch64', pkgOs: 'linux', osField: 'linux', cpu: 'arm64', suffix: 'so' },
  { dir: 'macos-x86_64', pkgOs: 'darwin', osField: 'darwin', cpu: 'x64', suffix: 'dylib' },
  { dir: 'macos-aarch64', pkgOs: 'darwin', osField: 'darwin', cpu: 'arm64', suffix: 'dylib' },
  { dir: 'windows-x86_64', pkgOs: 'windows', osField: 'win32', cpu: 'x64', suffix: 'dll' },
  { dir: 'windows-aarch64', pkgOs: 'windows', osField: 'win32', cpu: 'arm64', suffix: 'dll' }
]

const writeJson = (path, obj) => writeFileSync(path, JSON.stringify(obj, null, 2))
const copyLicenses = (destDir) => {
  for (const f of LICENSE_FILES) if (existsSync(f)) copyFileSync(f, join(destDir, f))
}

// --- per-platform binary packages ------------------------------------------
const present = []
for (const p of PLATFORMS) {
  const binName = `${ENTRYPOINT_BASE_NAME}.${p.suffix}`
  const src = join('dist', p.dir, binName)
  if (!existsSync(src)) {
    console.log(`skip ${p.dir}: ${src} not found`)
    continue
  }
  const name = `${BASE_PACKAGE_NAME}-${p.pkgOs}-${p.cpu}`
  const dir = join(OUT, name)
  mkdirSync(dir, { recursive: true })
  copyFileSync(src, join(dir, binName))
  copyLicenses(dir)
  // No `files` field: publishing from a directory runs `npm pack`, which honors
  // `files`; sqlite-dist could set `files: []` because it hand-built the tarball,
  // but we must let npm include the binary — the default (no `files`) does that.
  writeJson(join(dir, 'package.json'), {
    name,
    version: VERSION,
    author: AUTHOR,
    license: LICENSE,
    description: DESCRIPTION,
    repository: { type: 'git', url: REPO },
    exports: { [`./${binName}`]: { default: `./${binName}` } },
    os: [p.osField],
    cpu: [p.cpu]
  })
  present.push({ ...p, name, binName })
  console.log(`packed ${name}`)
}
if (present.length === 0) throw new Error('No platform binaries found under dist/*/ — nothing to pack')

// --- loader package --------------------------------------------------------
const supportedPlatforms = present.map((p) => [p.osField, p.cpu])
const loaderDir = join(OUT, BASE_PACKAGE_NAME)
mkdirSync(loaderDir, { recursive: true })
copyLicenses(loaderDir)
writeJson(join(loaderDir, 'package.json'), {
  name: BASE_PACKAGE_NAME,
  version: VERSION,
  author: AUTHOR,
  license: LICENSE,
  description: DESCRIPTION,
  repository: { type: 'git', url: REPO },
  main: './index.cjs',
  module: './index.mjs',
  types: './index.d.ts',
  exports: { '.': { require: './index.cjs', import: './index.mjs', types: './index.d.ts' } },
  optionalDependencies: Object.fromEntries(present.map((p) => [p.name, VERSION]))
})
writeFileSync(join(loaderDir, 'index.mjs'), indexJs('esm', supportedPlatforms))
writeFileSync(join(loaderDir, 'index.cjs'), indexJs('cjs', supportedPlatforms))
writeFileSync(join(loaderDir, 'index.d.ts'), indexDts())
console.log(`packed ${BASE_PACKAGE_NAME} (loader) supportedPlatforms=${JSON.stringify(supportedPlatforms)}`)

// --- templates (faithful to sqlite-dist's npm target) ----------------------
function indexDts() {
  return `/** Absolute path to the platform-specific vec0 loadable extension. */
export declare function getLoadablePath(): string;

interface Db {
  loadExtension(file: string, entrypoint?: string | undefined): void;
}

/** Load the vec0 extension into a better-sqlite3 / libsql database. */
export declare function load(db: Db): void;
`
}

function indexJs(format, platforms) {
  const base = JSON.stringify(BASE_PACKAGE_NAME)
  const entry = JSON.stringify(ENTRYPOINT_BASE_NAME)
  const plats = JSON.stringify(platforms)
  const imports =
    format === 'cjs'
      ? 'const { arch, platform } = require("node:process");'
      : 'import { fileURLToPath } from "node:url";\nimport { arch, platform } from "node:process";'
  const exportsLine =
    format === 'cjs' ? 'module.exports = {getLoadablePath, load};' : 'export {getLoadablePath, load};'
  const resolve =
    format === 'cjs'
      ? 'require.resolve(packageName + "/" + ENTRYPOINT_BASE_NAME + "." + extensionSuffix(platform))'
      : 'fileURLToPath(import.meta.resolve(packageName + "/" + ENTRYPOINT_BASE_NAME + "." + extensionSuffix(platform)))'
  return `${imports}

const BASE_PACKAGE_NAME = ${base};
const ENTRYPOINT_BASE_NAME = ${entry};
const supportedPlatforms = ${plats};

const invalidPlatformErrorMessage = \`Unsupported platform for \${BASE_PACKAGE_NAME}, on a \${platform}-\${arch} machine. Supported platforms are (\${supportedPlatforms
  .map(([p, a]) => \`\${p}-\${a}\`)
  .join(",")}). Consult the \${BASE_PACKAGE_NAME} NPM package README for details.\`;

const extensionNotFoundErrorMessage = (packageName) =>
  \`Loadable extension for \${BASE_PACKAGE_NAME} not found. Was the \${packageName} package installed?\`;

function validPlatform(platform, arch) {
  return supportedPlatforms.find(([p, a]) => platform === p && arch === a) !== undefined;
}
function extensionSuffix(platform) {
  if (platform === "win32") return "dll";
  if (platform === "darwin") return "dylib";
  return "so";
}
function platformPackageName(platform, arch) {
  const os = platform === "win32" ? "windows" : platform;
  return \`\${BASE_PACKAGE_NAME}-\${os}-\${arch}\`;
}

function getLoadablePath() {
  if (!validPlatform(platform, arch)) {
    throw new Error(invalidPlatformErrorMessage);
  }
  const packageName = platformPackageName(platform, arch);
  const loadablePath = ${resolve};
  return loadablePath;
}

function load(db) {
  db.loadExtension(getLoadablePath());
}

${exportsLine}
`
}
