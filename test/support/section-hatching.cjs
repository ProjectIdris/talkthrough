// An isolated native GPU probe. No app state, credentials, network, or model input.
const { app, BrowserWindow } = require('electron');
const { join } = require('node:path');
const { readFileSync, writeFileSync } = require('node:fs');
const out = process.argv[2];
app.setPath('userData', join(out, 'profile'));
app.setPath('sessionData', join(out, 'profile'));
let window;
app.whenReady().then(async () => {
  window = new BrowserWindow({ show: false, width: 160, height: 100, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await window.loadURL('data:text/html,<html><body></body></html>');
  const fragment = readFileSync(join(out, 'fragment.glsl'), 'utf8');
  const result = await window.webContents.executeJavaScript(`(${probe.toString()})(${JSON.stringify(fragment)})`);
  writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2));
  window.destroy();
  app.exit(0);
}).catch(error => { console.error(error); if (window) window.destroy(); app.exit(1); });

function probe(fragment) {
  const canvas = document.createElement('canvas');
  const width = 64, height = 4;
  canvas.width = width; canvas.height = height;
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
  if (!gl) throw new Error('WebGL2 unavailable');
  const compile = (type, source) => {
    const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, `#version 300 es
    precision highp float;
    in vec2 position;
    uniform vec3 phase;
    out vec3 vCapWorld;
    void main() {
      vec2 pixel = (position + 1.0) * vec2(32.0, 2.0);
      float value = phase.x + phase.y * pixel.x + phase.z * pixel.y;
      vCapWorld = vec3(value * (0.16 / 0.78), 0.0, 0.0);
      gl_Position = vec4(position, 0.0, 1.0);
    }`);
  const pixel = compile(gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, pixel); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
  const location = gl.getAttribLocation(program, 'position'); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
  const uniform = gl.getUniformLocation(program, 'phase');
  const pixels = new Uint8Array(width * height * 4);
  gl.disable(gl.DITHER);
  const stripe = value => {
    const p = value - Math.floor(value);
    const smooth = (a, b) => { const t = Math.max(0, Math.min(1, (p - a) / (b - a))); return t*t*(3-2*t); };
    return smooth(.38,.5) * (1-smooth(.62,.74));
  };
  // Independent numerical integration of the original stripe, not the shader's primitive.
  const integral = (phase, span) => {
    if (span < .001) return stripe(phase);
    const n = 4096;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += stripe(phase + span * ((i + .5) / n - .5));
    return sum / n;
  };
  const widths = [0, .0005, .001, .002, .02, .12, .4, .999, 1, 1.25, 2, 16];
  const phases = [-10.63, -.001, .48, 7.99];
  const orientations = [[1,0], [-1,0], [.4,.6]];
  let cases = 0, samples = 0, maxError = 0, maxDenseVariation = 0;
  const failures = [];
  for (const span of widths) for (const offset of phases) for (const [x,y] of orientations) {
    gl.uniform3f(uniform, offset, span*x, span*y);
    gl.drawArrays(gl.TRIANGLES, 0, 6); gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let min = 1, max = 0;
    for (let i = 0; i < width; i++) {
      const actual = pixels[(width + i)*4] / 255;
      const phase = offset + span * (x*(i+.5) + y*1.5);
      const expected = 1 - .45*integral(phase, span);
      const error = Math.abs(actual - expected);
      maxError = Math.max(maxError, error); min = Math.min(min, actual); max = Math.max(max, actual);
      if (error > 2.5/255 && failures.length < 12) failures.push({ span, offset, x, y, i, actual, expected, error });
      samples++;
    }
    if (span === 1 || span === 2 || span === 16) maxDenseVariation = Math.max(maxDenseVariation, max-min);
    cases++;
  }
  const extension = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(pixel); gl.deleteBuffer(buffer);
  return { cases, samples, maxError, maxDenseVariation, failures, renderer };
}
