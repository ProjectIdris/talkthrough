import { app, dialog, nativeImage, screen } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { uIOhook, UiohookKey } from 'uiohook-napi';
import { parseArgs } from './args.ts';
import { createClaudeModel } from '../adapters/claude-model.ts';
import { createCodexModel } from '../adapters/codex-model.ts';
import { createLocalSpeechServerRecogniser } from '../adapters/local-speech-server.ts';
import type { Model } from '../adapters/model.ts';
import type { SpeechToText } from '../adapters/speech-to-text.ts';
import type { Screenshot } from '../adapters/types.ts';
import { displayUnderPointer } from './capture.ts';
import { runGrab } from './grab.ts';
import { startHotkey } from './hotkey.ts';
import { createMedia } from './media.ts';
import { createOverlayManager } from './overlay-windows.ts';
import { createSamplePlayer } from './samples.ts';
import { createSession } from './session.ts';
import { loadSettings } from './settings.ts';
import { createTray } from './tray.ts';

// Nothing in this process may ever pop an error dialog on the user's screen: log it and leave.
dialog.showErrorBox = () => undefined;
process.on('uncaughtException', (error) => {
  console.error('[talkthrough] uncaught error:', error);
  app.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[talkthrough] unhandled rejection:', reason);
});

const options = parseArgs(process.argv.slice(1));

// The GPU is reserved for other work for now: software rendering unless asked. WebGL still works
// (it falls back to the system's software rasteriser; no extra Chromium flag is needed).
if (!options.gpu && process.env.TALKTHROUGH_GPU !== '1') app.disableHardwareAcceleration();
if (options.grab && options.grab.scaleFactor !== 1) app.commandLine.appendSwitch('force-device-scale-factor', String(options.grab.scaleFactor));
if (options.fakeMic) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
  if (options.fakeMicFile) app.commandLine.appendSwitch('use-file-for-fake-audio-capture', options.fakeMicFile);
}

const startedAt = performance.now();
const log = (message: string) => console.log(`[talkthrough +${((performance.now() - startedAt) / 1000).toFixed(2)}s] ${message}`);

const preload = join(__dirname, 'preload.cjs');
const audioPreload = join(__dirname, 'audio-preload.cjs');
// A stand-in overlay page may be named for development only; a packaged app always loads its own.
const overlayPage = (!app.isPackaged && process.env.TALKTHROUGH_OVERLAY_PAGE) || join(__dirname, '..', 'overlay', 'index.html');
const audioPage = join(__dirname, '..', 'audio', 'index.html');

// A second launch must not get as far as making windows or the key hook.
const firstInstance = options.grab !== undefined || app.requestSingleInstanceLock();
if (!firstInstance) app.exit(0);

app.on('window-all-closed', () => {
  // Stay alive in the tray when every window is closed.
});

/** A stand-in screenshot for checks: an image file used instead of grabbing the screen. */
function loadCaptureImage(path: string): Screenshot {
  const bytes = readFileSync(path);
  const size = nativeImage.createFromBuffer(bytes).getSize();
  return { mime: 'image/png', base64: bytes.toString('base64'), width: size.width, height: size.height };
}

/** Checks: after a chord release, writes a picture of the overlay every so often. */
function createFrameRecorder(dir: string, everyMs: number, overlays: ReturnType<typeof createOverlayManager>, say: (line: string) => void) {
  mkdirSync(dir, { recursive: true });
  let timer: NodeJS.Timeout | null = null;
  let from = 0;
  let count = 0;
  const take = async () => {
    for (const id of overlays.displayIds()) {
      const png = await overlays.snapshot(id);
      if (png && count < 200) {
        writeFileSync(join(dir, `frame-${String(Date.now() - from).padStart(6, '0')}.png`), png);
        count++;
      }
    }
  };
  return {
    start() {
      if (timer) return;
      from = Date.now();
      timer = setInterval(() => void take().catch((e: unknown) => say(`frame: ${String(e)}`)), everyMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

async function main(): Promise<void> {
  if (!firstInstance) return;
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

  const settingsPath = options.settings ?? join(app.getPath('userData'), 'settings.json');
  const settings = loadSettings(settingsPath, (m) => log(`settings: ${m}`));
  log(`settings file: ${settingsPath}`);
  const samples = createSamplePlayer(join(app.getAppPath(), 'samples', 'scenes'));
  let session: ReturnType<typeof createSession> | null = null;
  const overlays = createOverlayManager({
    preload,
    page: overlayPage,
    ...(options.backdrop ? { backdrop: options.backdrop } : {}),
    hideFromCapture: !options.visibleToCapture,
    hidden: options.hidden,
    silent: options.silentVoice,
    onReady: log,
    onDone: () => session?.done(),
    onOffer: (displayId) => void session?.offer(displayId),
    onMilestone: (m) => session?.milestone(m),
  });
  overlays.start();
  const media = createMedia({ preload: audioPreload, page: audioPage });
  void media.warm();

  const fixedQuestion = options.question;
  const speech: SpeechToText | null = fixedQuestion
    ? { id: 'fixed-text', transcribe: async () => ({ text: fixedQuestion }) } // checks only: skips the speech server
    : settings.speechServerUrl ? createLocalSpeechServerRecogniser({ url: settings.speechServerUrl, ...(settings.speechLimitMs ? { limitMs: settings.speechLimitMs } : {}) }) : null;
  if (fixedQuestion) log('question text fixed for this run (speech server not used)');
  else if (speech) {
    // Only ever asks whether the server is up; the app never starts it.
    speech.warm?.().then(() => log('speech server reachable'), (error: unknown) => log(`speech server: ${error instanceof Error ? error.message : String(error)}`));
  } else log('no speech server in the settings: questions cannot be heard yet');

  const model: Model = settings.model === 'claude'
    ? createClaudeModel({ model: settings.claudeModel, effort: settings.effort, ...(settings.claudeCommand ? { command: settings.claudeCommand } : {}) })
    : createCodexModel({ model: settings.codexModel, fast: settings.codexFast, effort: settings.effort, log, ...(settings.codexCommand ? { command: settings.codexCommand } : {}) });
  model.warm?.().catch((error: unknown) => log(`model: ${error instanceof Error ? error.message : String(error)}`));
  log(`model ${model.id}`);

  const captureImage = options.captureImage ? loadCaptureImage(options.captureImage) : null;
  let chordsDone = 0;
  const frames = options.framesDir ? createFrameRecorder(options.framesDir, options.frameEveryMs, overlays, log) : null;

  session = createSession({
    pointerDisplayId: () => displayUnderPointer().id,
    media: {
      startMic: () => media.startMic(),
      stopMic: () => media.stopMic(),
      abortMic: () => media.abortMic(),
      capture: async (displayId) => {
        if (captureImage) return { screenshot: captureImage, ms: 0 };
        const display = screen.getAllDisplays().find((d) => d.id === displayId) ?? displayUnderPointer();
        const c = await media.capture(display, settings.screenshotEdge);
        if (options.saveCapture) writeFileSync(options.saveCapture, Buffer.from(c.screenshot.base64, 'base64'));
        log(`screenshot ${c.screenshot.width}x${c.screenshot.height} (display ${c.nativeWidth}x${c.nativeHeight}) grabbed in ${c.ms} ms`);
        return c;
      },
    },
    speech,
    model: () => model,
    send: (displayId, message) => {
      if (options.logSteps && message.kind === 'step') log(`step ${JSON.stringify(message.step)}`);
      overlays.send(displayId, message);
    },
    log,
    micWindowMs: settings.micWindowMs,
    onReport: (report) => {
      if (!options.exitAfterChord) return;
      if (report.endMs === undefined && !report.error) return;
      if (reported.has(report)) return;
      reported.add(report);
      if (++chordsDone >= options.exitAfterChord) setTimeout(quit, (report.error ? 3 : options.settleSeconds) * 1000);
    },
  });
  media.onStarted = () => session?.micStarted();
  const reported = new WeakSet<object>();

  const playSample = (displayId: number) => {
    const sample = samples.next();
    if (!sample) return log('no sample scenes found');
    log(`playing sample ${sample.name} (turn ${sample.turn}, ${sample.scene.steps.length} steps, ${sample.issues} validator notes)`);
    overlays.send(displayId, { kind: 'play', scene: sample.scene, turn: sample.turn });
  };

  const quit = () => {
    if (quitting) return;
    quitting = true;
    hotkey?.stop();
    frames?.stop();
    session?.dispose();
    overlays.dispose();
    media.dispose();
    tray.destroy();
    // Let the model's process end (and its working folder go) before we leave, but never hang on it.
    void Promise.race([Promise.resolve(model.close?.()), new Promise((r) => setTimeout(r, 3000))]).finally(() => app.exit(0));
  };
  let quitting = false;
  const tray = createTray({
    onQuit: quit,
    onClear: () => {
      overlays.clearAll();
      session?.reset();
    },
    onPlaySample: () => playSample(screen.getPrimaryDisplay().id),
  });

  let hotkey: ReturnType<typeof startHotkey> | null = null;
  if (!options.noHotkey) {
    try {
      hotkey = startHotkey({
        arm: () => session?.arm(),
        cancel: () => session?.cancel(),
        start: () => {
          log('chord pressed');
          session?.start();
        },
        stop: () => {
          frames?.start();
          session?.stop();
        },
      });
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
    // One press per question asked for (two by default); a further press would stop an answer still arriving.
    const presses = options.exitAfterChord || 2;
    for (let i = 0; i < presses; i++) setTimeout(() => press(options.chordHoldMs), 2500 + i * (options.chordHoldMs + 6000));
  }
  if (options.maxSeconds) setTimeout(quit, options.maxSeconds * 1000);
}

main().catch((error) => {
  console.error(`[talkthrough] ${error instanceof Error ? error.message : String(error)}`);
  app.exit(1);
});
