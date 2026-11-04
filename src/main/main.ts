import { app, screen } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { uIOhook, UiohookKey } from 'uiohook-napi';
import { parseArgs } from './args.ts';
import { captureDisplay, displayUnderPointer } from './capture.ts';
import type { Capture } from './capture.ts';
import { runGrab } from './grab.ts';
import { startHotkey } from './hotkey.ts';
import { createMic } from './mic.ts';
import { createOverlayManager } from './overlay-windows.ts';
import { createSamplePlayer } from './samples.ts';
import { createTray } from './tray.ts';

const options = parseArgs(process.argv.slice(1));

// The GPU is reserved for other work for now: software rendering unless asked. WebGL still works
// (it falls back to the system's software rasteriser; no extra Chromium flag is needed).
if (!options.gpu && process.env.TALKTHROUGH_GPU !== '1') app.disableHardwareAcceleration();
if (options.fakeMic) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
}

const startedAt = performance.now();
const log = (message: string) => console.log(`[talkthrough +${((performance.now() - startedAt) / 1000).toFixed(2)}s] ${message}`);

const preload = join(__dirname, 'preload.cjs');
const audioPreload = join(__dirname, 'audio-preload.cjs');
const overlayPage = process.env.TALKTHROUGH_OVERLAY_PAGE ?? join(__dirname, '..', 'overlay', 'index.html');
const audioPage = join(__dirname, '..', 'audio', 'index.html');

if (!options.grab && !app.requestSingleInstanceLock()) app.quit();

app.on('window-all-closed', () => {
  // Stay alive in the tray when every window is closed.
});

async function main(): Promise<void> {
  app.setName('Talkthrough');
  await app.whenReady();
  if (!existsSync(overlayPage)) throw new Error(`overlay page not found: ${overlayPage} (run npm run build)`);

  if (options.grab) {
    try {
      const files = await runGrab(options.grab, options.backdrop, { preload, page: overlayPage });
      for (const file of files) log(`wrote ${file}`);
      app.exit(0);
    } catch (error) {
      console.error(`[talkthrough] grab failed: ${error instanceof Error ? error.message : String(error)}`);
      app.exit(1);
    }
    return;
  }

  const samples = createSamplePlayer(join(app.getAppPath(), 'samples', 'scenes'));
  const overlays = createOverlayManager({
    preload,
    page: overlayPage,
    ...(options.backdrop ? { backdrop: options.backdrop } : {}),
    hideFromCapture: !options.visibleToCapture,
    onReady: log,
  });
  overlays.start();
  const mic = createMic({ preload: audioPreload, page: audioPage });
  void mic.warm();

  const playSample = (displayId: number) => {
    const sample = samples.next();
    if (!sample) return log('no sample scenes found');
    log(`playing sample ${sample.name} (turn ${sample.turn}, ${sample.scene.steps.length} steps, ${sample.issues} validator notes)`);
    overlays.send(displayId, { kind: 'play', scene: sample.scene, turn: sample.turn });
  };

  const quit = () => {
    hotkey?.stop();
    overlays.dispose();
    mic.dispose();
    tray.destroy();
    app.exit(0);
  };
  const tray = createTray({ onQuit: quit, onPlaySample: () => playSample(screen.getPrimaryDisplay().id) });

  // The chord: capture the screen and record the question while held; on release, play a sample.
  let recording: { capture: Promise<Capture>; displayId: number; timer: NodeJS.Timeout; pressedAt: number } | null = null;
  const holdLimitMs = 60_000;
  let chordsDone = 0;

  const onChordStart = () => {
    if (recording) return;
    log('chord pressed');
    overlays.clearAll();
    const display = displayUnderPointer();
    const capture = captureDisplay(display);
    capture.catch(() => undefined); // reported when the chord is released
    const timer = setTimeout(onChordStop, holdLimitMs);
    recording = { capture, displayId: display.id, timer, pressedAt: performance.now() };
    mic.start().catch((error: unknown) => log(`microphone: ${error instanceof Error ? error.message : String(error)}`));
  };

  const onChordStop = () => {
    const active = recording;
    if (!active) return;
    log('chord released');
    recording = null;
    clearTimeout(active.timer);
    void (async () => {
      const [clip, shot] = await Promise.allSettled([mic.stop(), active.capture]);
      if (clip.status === 'fulfilled') {
        let sum = 0;
        for (const s of clip.value.samples) sum += s * s;
        const rms = Math.sqrt(sum / Math.max(1, clip.value.samples.length));
        log(`chord held ${((performance.now() - active.pressedAt) / 1000).toFixed(2)} s; question audio: ${(clip.value.durationMs / 1000).toFixed(2)} s at ${clip.value.sampleRate} Hz, rms ${rms.toFixed(3)}, recorder started ${clip.value.startLatencyMs} ms after the press`);
      } else log(`question audio failed: ${clip.reason instanceof Error ? clip.reason.message : String(clip.reason)}`);
      if (shot.status === 'fulfilled') {
        const c = shot.value;
        log(`screenshot: ${c.screenshot.width}x${c.screenshot.height} (display ${c.nativeWidth}x${c.nativeHeight}) captured in ${c.ms} ms, ${(c.screenshot.base64.length * 0.75 / 1024).toFixed(0)} KB, kept in memory only`);
      } else log(`capture failed: ${shot.reason instanceof Error ? shot.reason.message : String(shot.reason)}`);
      playSample(active.displayId);
      if (options.exitAfterChord && ++chordsDone >= options.exitAfterChord) setTimeout(quit, 2500);
    })();
  };

  let hotkey: ReturnType<typeof startHotkey> | null = null;
  if (!options.noHotkey) {
    try {
      hotkey = startHotkey({ start: onChordStart, stop: onChordStop });
    } catch (error) {
      log(`the key hook could not start: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  log(hotkey ? 'ready: hold Right Ctrl + Right Shift' : 'ready (hotkey off)');

  if (options.playSample) playSample(screen.getPrimaryDisplay().id);
  if (options.selfChord) {
    // Check only: press and release the chord through the hook itself, once.
    const press = (holdMs: number) => {
      uIOhook.keyToggle(UiohookKey.CtrlRight, 'down');
      uIOhook.keyToggle(UiohookKey.ShiftRight, 'down');
      setTimeout(() => {
        uIOhook.keyToggle(UiohookKey.ShiftRight, 'up');
        uIOhook.keyToggle(UiohookKey.CtrlRight, 'up');
      }, holdMs);
    };
    setTimeout(() => press(2000), 2500);
    setTimeout(() => press(2000), 8500);
  }
  if (options.maxSeconds) setTimeout(quit, options.maxSeconds * 1000);
}

main().catch((error) => {
  console.error(`[talkthrough] ${error instanceof Error ? error.message : String(error)}`);
  app.exit(1);
});
