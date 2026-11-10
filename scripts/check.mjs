import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'

const manifest = JSON.parse(await readFile(new URL('../orca-plugin.json', import.meta.url), 'utf8'))
const packageFile = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

assert.equal(manifest.manifestVersion, 2)
assert.equal(manifest.id, 'request-lab')
assert.equal(manifest.execution, 'trusted-worker')
assert.equal(manifest.version, packageFile.version, 'Manifest and package versions must match')
assert.match(manifest.engines.orca, /^>=\d+\.\d+\.\d+$/)
assert.equal(manifest.pluginApi, 1)

for (const path of [manifest.main, ...manifest.contributes.panels.map(panel => panel.entry), ...manifest.contributes.customEditors.map(editor => editor.entry)]) {
  await access(new URL(`../${path}`, import.meta.url))
}

console.log(`Request Lab ${manifest.version}: repository checks passed`)
