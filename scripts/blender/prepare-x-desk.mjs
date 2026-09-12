/** Lossless original fallback; compact poster from the reviewed Blender render. */
import sharp from 'sharp';
import { copyFile } from 'node:fs/promises';
await copyFile('assets/x-desk-210027/references/01.webp', 'public/models/x-desk-210027/original.webp');
await sharp('assets/x-desk-210027/renders/v1-poster.png').flatten({ background: '#ffffff' }).resize(1000, 1000).webp({ quality: 88 }).toFile('public/models/x-desk-210027/poster-v1.webp');
