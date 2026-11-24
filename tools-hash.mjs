import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
const files = process.argv.slice(2);
const lines = files.map(file => `${createHash('sha256').update(readFileSync(file)).digest('hex')}  ${basename(file)}`);
writeFileSync('SHA256SUMS.txt', lines.join('\n') + '\n');
console.log(lines.join('\n'));
