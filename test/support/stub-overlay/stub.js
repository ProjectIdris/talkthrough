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
// Live turns: steps are appended and drawn at once; the first one is reported as the first mark and first word.
let live = { steps: [] };
let banner = '';
function drawBanner() {
  if (!banner) return;
  ctx.fillStyle = 'black'; ctx.font = '32px sans-serif'; ctx.fillText(banner, 40, canvas.height - 40);
}
window.talkthrough.onScene((m) => {
  if (m.kind === 'begin') { if (m.turn === 1) live = { steps: [] }; banner = ''; window.__first = false; }
  if (m.kind === 'step') {
    live.steps.push(m.step); draw(live, live.steps.length - 1, 99); drawBanner();
    if (!window.__first) { window.__first = true; const at = Date.now(); window.talkthrough.milestone({ what: 'first-mark', at }); window.talkthrough.milestone({ what: 'first-word', at }); }
  }
  if (m.kind === 'end') { if (m.escalate) { banner = 'OFFER: ' + m.escalate; drawBanner(); } setTimeout(() => window.talkthrough.done(), 800); }
  if (m.kind === 'status') { banner = m.status === 'listening' || m.status === 'working' ? m.status : ''; ctx.clearRect(0, 0, canvas.width, canvas.height); if (live.steps.length) draw(live, live.steps.length - 1, 99); drawBanner(); }
  if (m.kind === 'notice') { banner = m.text; drawBanner(); }
  if (m.kind === 'clear') { live = { steps: [] }; ctx.clearRect(0, 0, canvas.width, canvas.height); }
  if (m.kind === 'play') { draw(m.scene, m.scene.steps.length - 1, 99); setTimeout(() => window.talkthrough.done(), 800); }
  if (m.kind === 'seek') { draw(m.scene, m.step, m.t); requestAnimationFrame(() => requestAnimationFrame(() => window.talkthrough.rendered(m.token))); }
});
window.talkthrough.ready();
// Check hook: pretend the pointer is over the 3D panel from 3 s to 5 s after load.
setTimeout(() => window.talkthrough.setInteractive(true), 3000);
setTimeout(() => window.talkthrough.setInteractive(false), 5000);
