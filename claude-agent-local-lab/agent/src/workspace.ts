import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';

// Fixed file names deliberately keep model inputs away from filesystem paths.
export const files = ['README.md', 'shipping.json'] as const;
export async function initializeWorkspace(root: string, sample: string) {
  await mkdir(root, { recursive: true });
  for (const file of files) {
    try { await copyFile(join(sample, file), join(root, file), 1); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
}
export function validateShipping(content: string) {
  const data = JSON.parse(content);
  if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('Expected a JSON object');
  const keys = Object.keys(data).sort().join(',');
  if (keys !== 'currency,expressShipping,freeShippingThreshold,standardShipping') throw new Error('Unexpected configuration fields');
  if (data.currency !== 'USD') throw new Error('Currency must be USD');
  for (const key of ['standardShipping', 'freeShippingThreshold', 'expressShipping']) {
    if (typeof data[key] !== 'number' || !Number.isFinite(data[key]) || data[key] < 0 || data[key] > 10000) throw new Error('Invalid price');
  }
  return data as { currency: string; standardShipping: number; freeShippingThreshold: number; expressShipping: number };
}
export function testShipping(content: string) {
  const config = validateShipping(content);
  const cases = [[0,7], [49,7], [50,0], [75,0], [100,0]];
  const results = cases.map(([subtotal, expected]) => {
    const actual = subtotal >= config.freeShippingThreshold ? 0 : config.standardShipping;
    return { name: `Standard shipping on $${subtotal}`, expected, actual, passed: actual === expected };
  });
  results.push({ name:'Express shipping', expected:15, actual:config.expressShipping, passed: config.expressShipping === 15 });
  return { passed: results.every(r => r.passed), results };
}
export async function readWorkspace(root: string) {
  return Object.fromEntries(await Promise.all(files.map(async file => [file, await readFile(join(root,file),'utf8')])));
}
export async function writeShipping(root: string, content: string) {
  validateShipping(content);
  await writeFile(join(root,'shipping.json'), JSON.stringify(JSON.parse(content),null,2)+'\n');
}
export function makePatch(before: string, after: string) {
  if (before === after) return '';
  const a = before.trimEnd().split('\n'), b = after.trimEnd().split('\n');
  return ['diff --git a/shipping.json b/shipping.json','--- a/shipping.json','+++ b/shipping.json',`@@ -1,${a.length} +1,${b.length} @@`,...a.map(x=>'-'+x),...b.map(x=>'+'+x),''].join('\n');
}
