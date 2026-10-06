#!/usr/bin/env node
/**
 * Puts the wall's on-device voice files in public/voice/ (git-ignored), so
 * Vite copies them into dist/ and Firebase Hosting serves them same-origin.
 * Every download is pinned by SHA-256; a mismatch fails loudly instead of
 * shipping a broken wall. Run by the deploy and wall-lab workflows, and by
 * `pnpm voice:assets` locally. Already-correct files are left alone.
 *
 *   openwakeword-0.5.1/   wake word models (github.com/dscripka/openWakeWord, release v0.5.1)
 *   vosk-model-small-en-us-0.15.tar.gz   speech model (alphacephei.com/vosk/models), repacked
 *                         from the official .zip into the .tar.gz vosk-browser reads
 *   ort-1.17.3/           ONNX Runtime Web's single-threaded WebAssembly, from node_modules
 *
 * The paths are mirrored in components/wall/voice/voiceAssets.ts; change both together.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'voice');

const OWW = 'https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/';
const DOWNLOADS = [
  ['openwakeword-0.5.1/melspectrogram.onnx', OWW + 'melspectrogram.onnx', 'ba2b0e0f8b7b875369a2c89cb13360ff53bac436f2895cced9f479fa65eb176f'],
  ['openwakeword-0.5.1/embedding_model.onnx', OWW + 'embedding_model.onnx', '70d164290c1d095d1d4ee149bc5e00543250a7316b59f31d056cff7bd3075c1f'],
  ['openwakeword-0.5.1/hey_jarvis_v0.1.onnx', OWW + 'hey_jarvis_v0.1.onnx', '94a13cfe60075b132f6a472e7e462e8123ee70861bc3fb58434a73712ee0d2cb'],
  ['openwakeword-0.5.1/hey_mycroft_v0.1.onnx', OWW + 'hey_mycroft_v0.1.onnx', 'c2a311e8fa1338de89c31b3b46dc4dffd4af2f9a8d6ddead48893c2d301b1f18'],
  ['openwakeword-0.5.1/hey_rhasspy_v0.1.onnx', OWW + 'hey_rhasspy_v0.1.onnx', '5a9b3ed3be2910e35780e097905aa9f35a9c10038df47914cf2b3ec4d670f6ea'],
];
const VOSK_NAME = 'vosk-model-small-en-us-0.15';
const VOSK_ZIP = ['https://alphacephei.com/vosk/models/' + VOSK_NAME + '.zip', '30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498'];
const ORT_FILES = ['ort-wasm-simd.wasm', 'ort-wasm.wasm'];
const ORT_DIR = 'ort-1.17.3';

const sha256 = buf => createHash('sha256').update(buf).digest('hex');

async function download(url, expected) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const got = sha256(buf);
      if (got !== expected) throw new Error(`checksum ${got}, expected ${expected}`);
      return buf;
    } catch (error) {
      if (attempt === 4) throw new Error(`${url}: ${error instanceof Error ? error.message : error}`);
      await new Promise(r => setTimeout(r, 2000 * 2 ** (attempt - 1)));
    }
  }
  throw new Error('unreachable');
}

const ok = (path, expected) => existsSync(path) && sha256(readFileSync(path)) === expected;

async function main() {
  for (const [rel, url, hash] of DOWNLOADS) {
    const dest = join(out, rel);
    if (ok(dest, hash)) continue;
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, await download(url, hash));
    console.log(`voice: ${rel}`);
  }

  // vosk-browser untars <one folder>/… (it strips the first path component).
  const tarPath = join(out, VOSK_NAME + '.tar.gz');
  // A dotfile: Firebase Hosting skips it ("**/.*" in firebase.json).
  const stamp = join(out, '.' + VOSK_NAME + '.source-sha256');
  if (!existsSync(tarPath) || !existsSync(stamp) || readFileSync(stamp, 'utf8').trim() !== VOSK_ZIP[1]) {
    const work = mkdtempSync(join(tmpdir(), 'vosk-'));
    try {
      const zip = join(work, 'model.zip');
      writeFileSync(zip, await download(VOSK_ZIP[0], VOSK_ZIP[1]));
      execFileSync('unzip', ['-q', zip, '-d', work]);
      if (!existsSync(join(work, VOSK_NAME, 'am', 'final.mdl'))) throw new Error(`${VOSK_NAME}.zip has an unexpected layout`);
      mkdirSync(out, { recursive: true });
      // Byte-identical on every run (GNU tar), so a deploy doesn't re-upload 41 MB.
      const plainTar = join(work, 'model.tar');
      try {
        execFileSync('tar', ['--sort=name', '--mtime=2020-01-01 00:00Z', '--owner=0', '--group=0', '--numeric-owner', '-cf', plainTar, '-C', work, VOSK_NAME]);
      } catch {
        execFileSync('tar', ['-cf', plainTar, '-C', work, VOSK_NAME]); // BSD tar (macOS)
      }
      execFileSync('gzip', ['-n', '-9', plainTar]);
      copyFileSync(plainTar + '.gz', tarPath);
      writeFileSync(stamp, VOSK_ZIP[1] + '\n');
      console.log(`voice: ${VOSK_NAME}.tar.gz`);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  // ONNX Runtime looks its .wasm up by file name next to the URL prefix it's given.
  const ortSrc = join(root, 'node_modules', 'onnxruntime-web', 'dist');
  for (const name of ORT_FILES) {
    const src = join(ortSrc, name);
    if (!existsSync(src)) throw new Error(`${src} is missing: run pnpm install`);
    const dest = join(out, ORT_DIR, name);
    if (existsSync(dest) && sha256(readFileSync(dest)) === sha256(readFileSync(src))) continue;
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    console.log(`voice: ${ORT_DIR}/${name}`);
  }

  writeFileSync(
    join(out, 'LICENSES.txt'),
    [
      'openwakeword-0.5.1/: openWakeWord pre-trained models by David Scripka,',
      '  https://github.com/dscripka/openWakeWord, licensed CC BY-NC-SA 4.0',
      '  (https://creativecommons.org/licenses/by-nc-sa/4.0/). Used unmodified.',
      `${VOSK_NAME}.tar.gz: Vosk model by Alpha Cephei, https://alphacephei.com/vosk/models,`,
      '  licensed Apache-2.0. Repacked from the official .zip, contents unmodified.',
      `${ORT_DIR}/: ONNX Runtime Web 1.17.3, https://github.com/microsoft/onnxruntime, licensed MIT.`,
      '',
    ].join('\n')
  );
  console.log('voice: assets ready in public/voice/');
}

main().catch(error => {
  console.error(`voice: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
