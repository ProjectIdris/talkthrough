// Isolated material probe: no app state, network, user files or security flags.
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
  window.destroy(); app.exit(0);
}).catch(error => { console.error(error); if (window) window.destroy(); app.exit(1); });

function probe(fragment) {
  const canvas = document.createElement('canvas');
  const width = 128, height = 4;
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
    uniform float fade;
    out vec3 vSurfaceCoord;
    void main() {
      vec2 pixel = (position + 1.0) * vec2(64.0, 2.0);
      vSurfaceCoord = vec3((phase.x + phase.y * pixel.x + phase.z * pixel.y) / 28.0, 0.0, fade);
      gl_Position = vec4(position, 0.0, 1.0);
    }`);
  const pixel = compile(gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, pixel); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
  const location = gl.getAttribLocation(program, 'position'); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
  const uniform = gl.getUniformLocation(program, 'phase'), fade = gl.getUniformLocation(program, 'fade');
  const pixels = new Uint8Array(width * height * 4);
  gl.disable(gl.DITHER);
  let denseCases = 0, resolvedContrast = 0, maxNeutralError = 0;
  const failures = [];
  for (const span of [0.03,0.75,1,2,16]) for (const offset of [-0.3,0,0.2,1.7]) for (const [x,y] of [[1,0],[-1,0],[0.4,0.6]]) for (const cap of [0,1]) {
    gl.uniform3f(uniform,offset,span*x,span*y); gl.uniform1f(fade,cap);
    gl.drawArrays(gl.TRIANGLES,0,6); gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    let min=1,max=0;
    for(let i=0;i<width;i++) {
      const color=pixels[(width+i)*4]/255, roughness=pixels[(width+i)*4+1]/255;
      min=Math.min(min,color);max=Math.max(max,color);
      if(color<0.435 || color>0.565 || roughness<0.425 || roughness>0.575) failures.push({span,offset,x,y,cap,i,color,roughness});
      if(span>=0.75 || cap===0) maxNeutralError=Math.max(maxNeutralError,Math.abs(color-0.5),Math.abs(roughness-0.5));
    }
    if(span>=0.75) denseCases++;
    if(span===0.03 && cap===1) resolvedContrast=Math.max(resolvedContrast,max-min);
  }
  const extension=gl.getExtension('WEBGL_debug_renderer_info');
  const renderer=extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
  gl.deleteProgram(program);gl.deleteShader(vertex);gl.deleteShader(pixel);gl.deleteBuffer(buffer);
  return {denseCases,resolvedContrast,maxNeutralError,failures:failures.slice(0,10),renderer};
}
