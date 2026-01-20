#!/usr/bin/env node
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(__dirname, '..');
const protosDir = resolve(root, 'prototypes');
const templatesDir = resolve(root, 'templates');

const args = process.argv.slice(2);
const name = args[0];
const type = args[1] || '2d'; // '2d' or '3d'

if (!name) {
  console.log('\nUsage: npm run new <name> [2d|3d]');
  console.log('Example: npm run new my-game 3d\n');
  process.exit(1);
}

// Find next number
const existing = readdirSync(protosDir);
const numbers = existing
  .map(f => f.match(/^proto-(\d+)/)?.[1])
  .filter(Boolean)
  .map(Number);
const nextNum = (Math.max(0, ...numbers) + 1).toString().padStart(3, '0');

const protoName = `proto-${nextNum}-${name}`;
const protoPath = resolve(protosDir, protoName);
const templatePath = resolve(templatesDir, type);

if (!existsSync(templatePath)) {
  console.error(`\n❌ Template "${type}" not found!`);
  process.exit(1);
}

// Copy template
mkdirSync(protoPath, { recursive: true });

const copyDir = (src, dest) => {
  readdirSync(src, { withFileTypes: true }).forEach(entry => {
    const srcPath = resolve(src, entry.name);
    const destPath = resolve(dest, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      copyDir(srcPath, destPath);
    } else {
      const content = readFileSync(srcPath, 'utf-8')
        .replace(/{{NAME}}/g, protoName);
      writeFileSync(destPath, content);
    }
  });
};

copyDir(templatePath, protoPath);

console.log(`\n✅ Created ${protoName}`);
console.log(`\nRun: npm run dev ${protoName}\n`);
