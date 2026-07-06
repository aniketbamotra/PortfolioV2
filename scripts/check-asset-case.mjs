// Pre-build guard: every /assets/… path referenced in src/ must match a git-tracked
// file at the EXACT case. macOS is case-insensitive so a mismatch (e.g. code wants
// Gemx.png, git has gemx.png) works locally but 404s on Cloudflare's case-sensitive
// Linux. We compare against `git ls-files` — the case git stores is what the server
// checks out, and it's the only source of truth that reveals the bug on a Mac.
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ASSET_EXTS = 'png|jpe?g|webp|ktx2|avif|svg|json|exr|hdr|glb|gltf|mp3|wav|ogg|webm|mp4|woff2?|ttf|otf';
const ASSET_RE = new RegExp(`/assets/[A-Za-z0-9_./-]+\\.(?:${ASSET_EXTS})`, 'g');
const SRC_RE = /\.(astro|[cm]?[jt]sx?|css|json|md|html)$/;

let tracked;
try {
  tracked = new Set(
    execSync('git ls-files public', { encoding: 'utf8' }).split('\n').filter(Boolean)
  );
} catch {
  console.warn('⚠ asset-case check skipped (not a git repo / git unavailable)');
  process.exit(0);
}

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (SRC_RE.test(e.name)) out.push(p);
  }
  return out;
}

const refs = new Map(); // "/assets/…" -> Set(files that reference it)
for (const file of walk('src')) {
  for (const [ref] of readFileSync(file, 'utf8').matchAll(ASSET_RE)) {
    if (!refs.has(ref)) refs.set(ref, new Set());
    refs.get(ref).add(file);
  }
}

const problems = [];
for (const [ref, files] of refs) {
  const expected = `public${ref}`;
  if (tracked.has(expected)) continue;
  const caseHint = [...tracked].find((t) => t.toLowerCase() === expected.toLowerCase());
  problems.push({ ref, files: [...files], caseHint });
}

if (problems.length) {
  console.error('\n✗ Asset case check failed — references that will 404 on a case-sensitive server:\n');
  for (const p of problems) {
    console.error(`  ${p.ref}`);
    console.error(`    referenced in: ${p.files.map((f) => relative('.', f)).join(', ')}`);
    console.error(
      p.caseHint
        ? `    git has:       /${p.caseHint.replace(/^public\//, '')}  ← case differs`
        : `    git has:       (no tracked file at this path)`
    );
    console.error('');
  }
  console.error('Fix a case mismatch with: git mv -f public/<current> public/<wanted>\n');
  process.exit(1);
}

console.log(`✓ asset-case check passed (${refs.size} asset references, all match git at exact case)`);
