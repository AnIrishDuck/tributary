import nacl from 'tweetnacl';
import fs from 'fs';

const keyPair = nacl.sign.keyPair();
const privateKeyBase64 = Buffer.from(keyPair.secretKey).toString('base64');
const publicKeyBase64 = Buffer.from(keyPair.publicKey).toString('base64');

fs.writeFileSync('write.key', privateKeyBase64);
fs.writeFileSync('public.key', publicKeyBase64);

console.log('Keys generated:');
console.log('Public key:', publicKeyBase64);
console.log('Private key saved to write.key');
