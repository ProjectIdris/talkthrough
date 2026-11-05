// Inspect or sanitize only the Windows native modules included in a disposable packaging copy.
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectPeDebugPaths, sanitizePeDebugPaths } from './pe-debug-paths.mjs';
export const nativeFiles=['get-windows/build/Release/node-get-windows.node','get-windows/lib/binding/napi-9-win32-unknown-x64/node-get-windows.node','uiohook-napi/build/Release/uiohook_napi.node','uiohook-napi/prebuilds/win32-x64/uiohook-napi.node'];
function presentFiles(root) {const files=nativeFiles.filter(name=>existsSync(resolve(root,name)));for(const family of ['get-windows/','uiohook-napi/'])if(!files.some(name=>name.startsWith(family)))throw new Error('Missing Windows native module');return files;}
export function checkNativeInputs(root) {let unsafe=0;for(const name of presentFiles(root))unsafe+=inspectPeDebugPaths(readFileSync(resolve(root,name))).unsafe;return unsafe;}
export function sanitizeOwnedCopy(root) {
 const requested=resolve(root);if(lstatSync(requested).isSymbolicLink()||realpathSync(requested)!==requested)throw new Error('Module root must be a standalone directory');
 const marker=resolve(requested,'.talkthrough-disposable-packaging');if(readFileSync(marker,'utf8').trim()!=='disposable packaging copy')throw new Error('Disposable packaging marker required');
 // Verify every target is an ordinary file inside this root before changing any file.
 const files=presentFiles(requested).map(name=>{const f=resolve(requested,name),real=realpathSync(f),rel=relative(requested,real);if(lstatSync(f).isSymbolicLink()||rel.startsWith('..'+sep)||rel==='..'||real!==f)throw new Error('Native input must stay inside owned copy');return f;});
 const results=files.map(f=>sanitizePeDebugPaths(readFileSync(f)));for(let i=0;i<files.length;i++)if(results[i].changed)writeFileSync(files[i],results[i].buffer);return results.reduce((n,x)=>n+x.changed,0);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){if(process.argv[2]!=='--owned-copy'||!process.argv[3]||process.argv.length!==4)throw new Error('Usage: node scripts/native-packaging.mjs --owned-copy <disposable node_modules>');console.log(`Sanitized ${sanitizeOwnedCopy(process.argv[3])} CodeView path(s)`);}
