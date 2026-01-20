#!/usr/bin/env node
import { createServer } from 'vite';
import { readdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(__dirname, '..');
const protosDir = resolve(root, 'prototypes');

// Get proto name from args or show list
const protoName = process.argv[2];

if (!protoName) {
  console.log('\n🎮 Prototypes disponibles:\n');
  const protos = readdirSync(protosDir).filter(f =>
    existsSync(resolve(protosDir, f, 'index.html'))
  );
  protos.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
  console.log('\nUsage: npm run dev <proto-name>');
  console.log('Example: npm run dev proto-001-2d-platformer\n');
  process.exit(0);
}

const protoPath = resolve(protosDir, protoName);

if (!existsSync(protoPath)) {
  console.error(`\n❌ Proto "${protoName}" not found!`);
  console.log('Run "npm run list" to see available protos.\n');
  process.exit(1);
}

console.log(`\n🚀 Starting ${protoName}...\n`);

const server = await createServer({
  root: protoPath,
  server: {
    port: 3000,
    open: true
  },
  resolve: {
    alias: {
      '@shared': resolve(root, 'shared')
    }
  }
});

await server.listen();
server.printUrls();
