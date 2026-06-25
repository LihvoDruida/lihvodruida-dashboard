#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const assetsDir = path.join(root, "public", "assets", "raid-thumbnails");
const required = ["normal", "heroic", "mythic"];

function readPngSize(filePath) {
  const buffer = fs.readFileSync(filePath);
  const pngSignature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== pngSignature) {
    throw new Error(`${path.basename(filePath)} is not a valid PNG file`);
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bytes: buffer.byteLength,
  };
}

for (const difficulty of required) {
  for (const name of [`${difficulty}.png`, `raid-${difficulty}.png`]) {
    const filePath = path.join(assetsDir, name);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing raid thumbnail asset: ${name}`);
    }
    const size = readPngSize(filePath);
    if (size.width !== size.height) {
      throw new Error(`${name} must be square, got ${size.width}x${size.height}`);
    }
    if (size.width < 256 || size.width > 1024) {
      throw new Error(`${name} has unsupported size ${size.width}x${size.height}`);
    }
  }
}

console.log(`[raid-thumbnails] OK — ${required.length * 2} PNG assets are present and valid.`);
