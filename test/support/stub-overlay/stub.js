// A stand-in overlay page for checking the main process before the real renderer is wired in:
// 2D marks only, no speech. Implements the same window.talkthrough contract.
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
let display = null;
function fit() {
  if (!display) return;
  const dpr = display.scaleFactor;
  canvas.style.width = display.bounds.width + 'px';
  canvas.style.height = display.bounds.height + 'px';
  canvas.width = Math.round(display.bounds.width * dpr);
  canvas.height = Math.round(display.bounds.height * dpr);
}
function draw(scene, step, t) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const sx = canvas.width / 1000, sy = canvas.height / 1000;
  ctx.lineWidth = 4; ctx.font = '28px sans-serif';
  scene.steps.slice(0, step + 1).forEach((s, i) => s.actions.forEach((a) => {
    if (i === step && (a.at ?? 0) > t) return;
    ctx.strokeStyle = ctx.fillStyle = a.color || 'red';
    if (a.op === 'box') ctx.strokeRect(a.x * sx, a.y * sy, a.w * sx, a.h * sy);
    if (a.op === 'label') ctx.fillText(a.text, a.x * sx, a.y * sy + 24);
  }));
}
window.talkthrough.onDisplay((d) => {
  display = d; fit();
  const bg = document.getElementById('bg');
  if (d.backdrop) { bg.src = d.backdrop; bg.style.display = 'block'; }
});
window.talkthrough.onScene((m) => {
  if (m.kind === 'clear') ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (m.kind === 'play') { draw(m.scene, m.scene.steps.length - 1, 99); setTimeout(() => window.talkthrough.done(), 800); }
  if (m.kind === 'seek') { draw(m.scene, m.step, m.t); requestAnimationFrame(() => requestAnimationFrame(() => window.talkthrough.rendered(m.token))); }
});
window.talkthrough.ready();
// Check hook: pretend the pointer is over the 3D panel from 3 s to 5 s after load.
setTimeout(() => window.talkthrough.setInteractive(true), 3000);
setTimeout(() => window.talkthrough.setInteractive(false), 5000);
