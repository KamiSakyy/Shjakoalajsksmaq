// Проверка синтаксиса всех GLSL-шейдеров проекта без браузера и GPU.
// Запуск: npm run check:shaders
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parser } from '@shaderfrog/glsl-parser';

const ROOT = process.cwd();
const PREFIX = `
precision highp float;
precision highp int;
uniform mat4 modelMatrix; uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix; uniform mat4 viewMatrix;
uniform mat3 normalMatrix; uniform vec3 cameraPosition; uniform float toneMappingExposure;
attribute vec3 position; attribute vec3 normal; attribute vec2 uv; attribute vec4 color;
vec4 linearToOutputTexel(vec4 v) { return v; }
vec3 toneMapping(vec3 c) { return c; }
`;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

const realStderr = process.stderr.write.bind(process.stderr);
process.stderr.write = () => true; // парсер шумит про gl_Position/gl_FragColor

let total = 0, failed = 0;
for (const file of walk(join(ROOT, 'src'))) {
  const src = readFileSync(file, 'utf8');
  const re = /\/\* glsl \*\/`([\s\S]*?)`/g;
  let m, i = 0;
  while ((m = re.exec(src))) {
    i++;
    total++;
    const code = PREFIX + m[1].replace(/#include <[a-z_0-9]+>/g, '');
    try {
      parser.parse(code);
    } catch (e) {
      failed++;
      realStderr(`${relative(ROOT, file)} — шейдер #${i}: ${e.message.split('\n')[0]}\n`);
    }
  }
}
realStderr(failed ? `\nШейдеры с ошибками: ${failed} из ${total}\n` : `Все шейдеры в порядке: ${total} шт.\n`);
process.exit(failed ? 1 : 0);
