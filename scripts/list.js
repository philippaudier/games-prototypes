#!/usr/bin/env node
import { readdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const protosDir = resolve(__dirname, '..', 'prototypes');

console.log('\n🎮 Prototypes disponibles:\n');

const protos = readdirSync(protosDir).filter(f =>
  existsSync(resolve(protosDir, f, 'index.html'))
);

if (protos.length === 0) {
  console.log('  Aucun prototype trouvé.');
  console.log('  Crée-en un avec: npm run new <name> [2d|3d]\n');
} else {
  protos.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
  console.log(`\nLancer un proto: npm run dev <proto-name>\n`);
}
