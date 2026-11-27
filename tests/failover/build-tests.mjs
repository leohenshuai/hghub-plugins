import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = process.env.HGHUB_PLUGIN_DIR || fileURLToPath(new URL('../../plugins/', import.meta.url));
const ids = ['avjb', 'xhamster', 'mwxk62', 'hkdoll'];
const sources = Object.fromEntries(ids.map(id => [id, fs.readFileSync(path.join(root, id + '.js'), 'utf8')]));
function xor(s, k) { return [...s].map((c, i) => (c.charCodeAt(0) ^ k.charCodeAt(i % k.length)).toString(16).padStart(2, '0')).join(''); }
const tail='0123456789', hash=crypto.createHash('md5').update(tail).digest('hex');
const token=xor(JSON.stringify({stream:'https://t26.cdn2020.com/path/index.m3u8'}),hash.slice(8,24).split('').reverse().join(''))+tail;
const key='0123456789abcdef0123456789abcdef';
const dollPage='var __PAGE__PARAMS__="'+xor(JSON.stringify({player:{embedUrl:'https://hongkongdollvideo.com/?token='+token}}),key)+key+'"';
const prefix = `const SOURCES=${JSON.stringify(sources)};\nconst DOLL_PAGE=${JSON.stringify(dollPage)};\nconst MD5=${JSON.stringify(hash)};\n`;
const tests=fs.readFileSync(new URL('./suite.js', import.meta.url),'utf8');
fs.writeFileSync(new URL('./bundle.cjs', import.meta.url),prefix+tests);
fs.writeFileSync(new URL('./bundle-qjs.js', import.meta.url),`import * as os from 'os';\nglobalThis.setTimeout=os.setTimeout;\nglobalThis.URL=class { constructor(u,b) { if(!/^https?:\\/\\//.test(u)){if(u.startsWith('//'))u='https:'+u;else {const m=b.match(/^(https?:\\/\\/[^/]+)(.*)$/);u=m[1]+(u.startsWith('/')?u:m[2].replace(/[^/]*$/,'')+u);}}this.href=u;this.origin=(u.match(/^https?:\\/\\/[^/]+/)||[])[0];this.pathname=u.slice(this.origin.length).split('?')[0];} };\n`+prefix+tests);
