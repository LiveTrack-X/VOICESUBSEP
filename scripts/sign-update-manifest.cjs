// Run only against a completed local release directory. Private key is never bundled.
const fs = require('node:fs');
const path = require('node:path');
const { sign, verify, createPublicKey } = require('node:crypto');
const { validateManifest } = require('../desktop/release-updater.cjs');
const directory = process.argv[2];
if (!directory) throw new Error('Usage: node scripts/sign-update-manifest.cjs <release-directory>');
const keyFile = process.env.VOICESUBSEP_RELEASE_KEY || path.join(process.env.LOCALAPPDATA, 'VOICESUBSEP-ReleaseKeys', 'update-ed25519.pem');
const privateKey = fs.readFileSync(keyFile);
const publicKey = fs.readFileSync(path.join(__dirname, '../desktop/update-public-key.pem'));
const ownPublic = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
if (String(ownPublic).trim() !== String(publicKey).trim()) throw new Error('Private key does not match the application verification key.');
const manifest = fs.readFileSync(path.join(directory, 'installer-manifest.json'));
const signature = sign(null, manifest, privateKey);
const version = JSON.parse(manifest).version;
validateManifest(manifest, signature, publicKey, version);
if (!verify(null, manifest, publicKey, signature)) throw new Error('Manifest signature verification failed.');
const output = path.join(directory, 'installer-manifest.sig');
if (fs.existsSync(output)) {
  if (!fs.readFileSync(output).equals(signature)) throw new Error('Existing signature differs; refusing to overwrite.');
} else fs.writeFileSync(output, signature, { flag: 'wx' });
console.log(`Signed update manifest for ${version}; private key was not copied.`);
