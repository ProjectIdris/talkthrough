import { app, dialog, safeStorage, screen, shell } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { uIOhook } from 'uiohook-napi';
import { parseArgs } from './args.ts';
import { createHttpBackend } from '../adapters/backend.ts';
import { createClaudeModel } from '../adapters/claude-model.ts';
import { createCodexModel } from '../adapters/codex-model.ts';
import { createLocalSpeechServerRecogniser } from '../adapters/local-speech-server.ts';
import { createOpenAIModel } from '../adapters/openai-model.ts';
import { createStepByStepModel } from '../adapters/step-by-step.ts';
import { createTwoStepModel } from '../adapters/two-step.ts';
import { sceneSchemaChain } from '../scene/schema.ts';
import type { Model } from '../adapters/model.ts';
import type { SpeechToText } from '../adapters/speech-to-text.ts';
import type { Screenshot } from '../adapters/types.ts';
import { displayUnderPointer } from './capture.ts';
import { runGrab } from './grab.ts';
import { gridOf } from './frame-grid.ts';
import type { Click } from './guide.ts';
import { startHotkey, watchGuideInput } from './hotkey.ts';
import { parseHotkey } from './chord.ts';
import { createFrontWindowReader } from './front-window.ts';
import { createSkipCheck } from './skip-list.ts';
import { createSettingsService } from './settings-service.ts';
import { createKeyStore } from './keystore.ts';
import { createMedia } from './media.ts';
import { createOverlayManager } from './overlay-windows.ts';
import { createPins } from './pins.ts';
import { createPrefs } from './prefs.ts';
import { createSamplePlayer } from './samples.ts';
import { createSession } from './session.ts';
import { createSettingsWindow } from './settings-window.ts';
import { createGuideNavigation } from './guide-nav.ts';
import { createConsentCard } from './consent-card.ts';
import { electronCardWindow } from './consent-window.ts';
import { createNavConsent } from './nav-consent.ts';
import { createVoiceBridge } from './voice-bridge.ts';
import { createNavigator } from './nav.ts';
import { createHelper } from './ps-helper.ts';
import { createUiaReader, toDisplayBoxes } from './uia.ts';
import { DETAIL_EFFORT, DETAIL_MODELS, DETAIL_TIMEOUT_MS, loadSettings } from './settings.ts';
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
const settingsPreload = join(__dirname, 'settings-preload.cjs');
const settingsPage = join(__dirname, '..', 'settings', 'index.html');

// A second launch must not get as far as making windows or the key hook.
const firstInstance = options.grab !== undefined || app.requestSingleInstanceLock();
if (!firstInstance) app.exit(0);

app.on('window-all-closed', () => {
  // Stay alive in the tray when every window is closed.
});

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
  // The person's say-so before the app acts for them (a yes first, a pause any time); only where it has hands at all.
  const navConsent = settings.guideNavigation && !options.captureImage ? createNavConsent() : undefined;
  // Where "may I do that for you?" is asked: a window of its own, because the overlay cannot take a click that arrives without a mouse move.
  const consentCard = navConsent
    ? createConsentCard({
      makeWindow: () => electronCardWindow({ hideFromCapture: !options.visibleToCapture }),
      areaOf: (displayId) => screen.getAllDisplays().find((d) => d.id === displayId)?.workArea ?? null,
      onAnswer: (yes) => void navConsent.answer(yes),
    })
    : undefined;
  // A voice server, when the person has set one up (never in a development run that speaks nothing): the pages ask main for its audio.
  const voice = settings.voiceServerUrl && !options.silentVoice
    ? {
      bridge: createVoiceBridge({ url: settings.voiceServerUrl, ...(settings.voiceServerVoice ? { voice: settings.voiceServerVoice } : {}), timeoutMs: settings.voiceTimeoutMs, log }),
      firstAudioMs: settings.voiceFirstAudioMs,
      cooldownMs: settings.voiceCooldownMs,
    }
    : undefined;
  const overlays = createOverlayManager({
    preload,
    page: overlayPage,
    ...(options.backdrop ? { backdrop: options.backdrop } : {}),
    hideFromCapture: !options.visibleToCapture,
    hidden: options.hidden,
    silent: options.silentVoice,
    ...(voice ? { voice } : {}),
    onReady: log,
    onDone: () => {
      session?.done();
      pageDone = true;
      askDetail();
    },
    onStroke: (displayId, stroke) => session?.stroke(displayId, stroke),
    onOffer: (displayId) => void session?.offer(displayId),
    ...(settings.detailRoute ? { onDetail: (displayId: number) => void session?.detail(displayId) } : {}),
    onMilestone: (m) => session?.milestone(m),
  });
  overlays.start();
  const media = createMedia({ preload: audioPreload, page: audioPage });
  void media.warm();

  const fixedQuestion = options.question;
  // "one || two": a different text for each question, the last one repeating
  const fixedTexts = (fixedQuestion ?? '').split('||').map((t) => t.trim());
  let spoken = 0;
  const speech: SpeechToText | null = fixedQuestion
    ? { id: 'fixed-text', transcribe: async () => ({ text: fixedTexts[Math.min(spoken++, fixedTexts.length - 1)] as string }) } // checks only: skips the speech server
    : settings.speechServerUrl ? createLocalSpeechServerRecogniser({ url: settings.speechServerUrl, ...(settings.speechLimitMs ? { limitMs: settings.speechLimitMs } : {}) }) : null;
  if (fixedQuestion) log('question text fixed for this run (speech server not used)');
  else if (speech) {
    // Only ever asks whether the server is up; the app never starts it.
    speech.warm?.().then(() => log('speech server reachable'), (error: unknown) => log(`speech server: ${error instanceof Error ? error.message : String(error)}`));
  } else log('no speech server in the settings: questions cannot be heard yet');

  // The API key, if the person uses that route: encrypted for their account, read only here, never logged.
  const keys = createKeyStore({ file: join(app.getPath('userData'), 'api-key.bin'), safeStorage });
  // The windows the person asked us not to look at (see skip-list.ts). The list is read each time, so one just saved protects at once.
  let skipList: readonly string[] = settings.captureBlocklist;
  // In a packaged app both the worker and the native file it loads are outside the archive (asarUnpack).
  const unpacked = (path: string): string => path.replace('app.asar' + sep, 'app.asar.unpacked' + sep);
  const frontReader = createFrontWindowReader({ file: unpacked(join(__dirname, 'front-window-worker.cjs')), addonDir: unpacked(join(__dirname, '..', '..', 'node_modules', 'get-windows')), log });
  const skipped = createSkipCheck(() => skipList, { read: () => frontReader.read(), log });
  if (skipList.length > 0) void frontReader.read().catch(() => undefined); // starts the reader now, not at the first press
  const settingsWindow = createSettingsWindow({
    onSaved: (form) => {
      skipList = form.captureBlocklist;
      if (skipList.length > 0) void frontReader.read().catch(() => undefined);
    },
    preload: settingsPreload,
    page: settingsPage,
    keys,
    settings: createSettingsService({ path: settingsPath, warn: (m) => log(`settings: ${m}`) }),
    onRestart: () => {
      app.relaunch();
      quit();
    },
  });
  const chord = parseHotkey(settings.hotkey) ?? parseHotkey('right-ctrl+right-shift')!;

  /** One route's model, locked down the same way whichever it is; the detail pass uses the same code with its own choices. */
  const makeModel = (route: 'codex' | 'claude' | 'openai', name: string, effort: string, quick: boolean, chain = false): Model => route === 'claude'
    ? createClaudeModel({ model: name, effort, ...(chain ? { schema: sceneSchemaChain } : {}), ...(quick ? {} : { timeoutMs: DETAIL_TIMEOUT_MS }), ...(settings.claudeCommand ? { command: settings.claudeCommand } : {}) })
    : route === 'openai'
      ? createOpenAIModel({
        apiKey: () => keys.load(),
        model: name,
        effort,
        ...(quick ? {} : { timeoutMs: DETAIL_TIMEOUT_MS }),
        ...(quick && settings.openaiServiceTier ? { serviceTier: settings.openaiServiceTier } : {}),
        ...(settings.openaiBaseUrl ? { baseUrl: settings.openaiBaseUrl } : {}),
      })
      : createCodexModel({ model: name, keepThread: quick, fast: quick && settings.codexFast, effort, log, ...(quick ? {} : { timeoutMs: DETAIL_TIMEOUT_MS }), ...(settings.codexCommand ? { command: settings.codexCommand } : {}) });
  // The Claude route can write its quick answer in pieces (step 1 first); the other routes answer fast enough on their own.
  const split = settings.model === 'claude' ? settings.splitAnswer : 'off';
  const quickModel = makeModel(settings.model, settings.model === 'claude' ? settings.claudeModel : settings.model === 'openai' ? settings.openaiModel : settings.codexModel, settings.effort, true, split === 'steps');
  const model: Model = split === 'two' ? createTwoStepModel(quickModel, { log }) : split === 'steps' ? createStepByStepModel(quickModel, { log }) : quickModel;
  // The detail model starts only when the person first asks for more detail (nothing is launched for it before that).
  let detailModel: Model | undefined;
  const detailRoute = settings.detailRoute;
  const detail = detailRoute
    ? () => (detailModel ??= makeModel(detailRoute, settings.detailModel ?? DETAIL_MODELS[detailRoute], settings.detailEffort ?? DETAIL_EFFORT, false))
    : undefined;
  model.warm?.().catch((error: unknown) => log(`model: ${error instanceof Error ? error.message : String(error)}`));
  log(`model ${model.id}`);

  const captureImage = options.captureImage ? readFileSync(options.captureImage) : null;
  let chordsDone = 0;
  let detailAsked = false;
  let answerEnded = false;
  let pageDone = false;
  const askDetail = (): void => {
    if (options.detailAfter === undefined || detailAsked || !answerEnded || !pageDone) return;
    detailAsked = true;
    setTimeout(() => void session?.detail(displayUnderPointer().id), options.detailAfter * 1000);
  };
  const frames = options.framesDir ? createFrameRecorder(options.framesDir, options.frameEveryMs, overlays, log) : null;

  const backend = settings.backendUrl ? createHttpBackend({ url: settings.backendUrl, ...(settings.backendTimeoutMs ? { timeoutMs: settings.backendTimeoutMs } : {}) }) : undefined;
  const pins = createPins({ dir: options.pinsDir ?? join(app.getPath('userData'), 'pins') });
  const prefs = createPrefs(join(app.getPath('userData'), 'prefs.json'));
  // Windows only, and only if the person has turned them on (both are off until they do); elsewhere, with a stand-in picture, or in a
  // browser window, marks snap to the picture alone and the app only points. One PowerShell helper serves both, started the first time
  // it is asked.
  const controlHelper = (settings.controlSnap || settings.guideNavigation) && !captureImage ? createHelper({ nav: settings.guideNavigation }) : undefined;
  const uia = controlHelper && settings.controlSnap ? createUiaReader({ helper: controlHelper }) : undefined;
  const navigator = controlHelper && settings.guideNavigation && navConsent ? createNavigator({ helper: controlHelper }) : undefined;
  session = createSession({
    skipped,
    ...(uia
      ? {
        controls: {
          read: async (displayId: number, signal?: AbortSignal) => {
            const display = screen.getAllDisplays().find((d) => d.id === displayId) ?? displayUnderPointer();
            const read = await uia.read(signal);
            return { boxes: toDisplayBoxes(read.controls, (p) => screen.screenToDipPoint(p), display.bounds), ms: read.ms, ...(read.why ? { why: read.why } : {}) };
          },
        },
      }
      : {}),
    pin: (input) => pins.save(input),
    pinScreenshot: () => prefs.get().pinScreenshot,
    ...(backend ? { backend } : {}),
    ...(detail ? { detailModel: detail } : {}),
    pointerDisplayId: () => displayUnderPointer().id,
    media: {
      startMic: () => media.startMic(),
      stopMic: () => media.stopMic(),
      abortMic: () => media.abortMic(),
      capture: async (displayId) => {
        if (await skipped()) throw new Error('the window in front is not to be looked at (the list of windows to skip)');
        const display = screen.getAllDisplays().find((d) => d.id === displayId) ?? displayUnderPointer();
        // A stand-in picture goes through the same page as a real grab, so a pen crop works the same way.
        const c = captureImage ? await media.captureFromImage(display, captureImage, settings.screenshotEdge) : await media.capture(display, settings.screenshotEdge);
        if (options.saveCapture) writeFileSync(options.saveCapture, Buffer.from(c.screenshot.base64, 'base64'));
        log(`screenshot ${c.screenshot.width}x${c.screenshot.height} (display ${c.nativeWidth}x${c.nativeHeight}) grabbed in ${c.ms} ms`);
        return c;
      },
      release: (grabId) => media.release(grabId),
      compose: async (grabId, strokes) => {
        const c = await media.compose(grabId, strokes, settings.screenshotEdge);
        if (options.savePen) {
          mkdirSync(options.savePen, { recursive: true });
          writeFileSync(join(options.savePen, 'pen-full.png'), Buffer.from(c.screenshot.base64, 'base64'));
          writeFileSync(join(options.savePen, 'pen-crop.png'), Buffer.from(c.crop.base64, 'base64'));
        }
        log(`pen: ${strokes.length} stroke(s), full ${c.screenshot.width}x${c.screenshot.height}, crop ${c.crop.width}x${c.crop.height} (box ${Math.round(c.box.x)},${Math.round(c.box.y)} ${Math.round(c.box.w)}x${Math.round(c.box.h)})`);
        return c;
      },
    },
    guide: {
      // A fresh look at the screen for the guide: the frame is let go at once (only the picture and its grid are kept).
      capture: async (displayId) => {
        if (await skipped()) throw new Error('the window in front is not to be looked at (the list of windows to skip)');
        const display = screen.getAllDisplays().find((d) => d.id === displayId) ?? displayUnderPointer();
        const c = captureImage ? await media.captureFromImage(display, captureImage, settings.screenshotEdge) : await media.capture(display, settings.screenshotEdge);
        media.release(c.grabId);
        return { screenshot: c.screenshot, grid: gridOf(c.screenshot) };
      },
      gridOf,
      listen: (_displayId, listener) => {
        // Screen pixels from the hook, on the 0..1000 scale of the display they landed on.
        const clickOf = (p: { x: number; y: number }): Click => {
          const dip = screen.screenToDipPoint(p);
          const d = screen.getDisplayNearestPoint(dip);
          return { x: ((dip.x - d.bounds.x) / d.bounds.width) * 1000, y: ((dip.y - d.bounds.y) / d.bounds.height) * 1000, displayId: d.id };
        };
        return watchGuideInput({ down: (p) => listener.down(clickOf(p)), up: (p) => listener.up(clickOf(p)), escape: () => listener.escape(), key: () => listener.key?.() });
      },
      ...(navigator && navConsent
        ? {
          navigation: createGuideNavigation({
            navigator,
            consent: navConsent,
            toScreen: (displayId, p) => {
              const d = screen.getAllDisplays().find((x) => x.id === displayId);
              return d ? screen.dipToScreenPoint({ x: d.bounds.x + (p.x / 1000) * d.bounds.width, y: d.bounds.y + (p.y / 1000) * d.bounds.height }) : null;
            },
            pointer: () => screen.getCursorScreenPoint(),
            log,
          }),
        }
        : {}),
    },
    setPen: (displayId) => overlays.setPen(displayId),
    speech,
    model: () => model,
    send: (displayId, message) => {
      if (options.logSteps && message.kind === 'step') log(`step ${JSON.stringify(message.step)}`);
      if (options.logSteps && message.kind === 'step-open') log(`step-open ${JSON.stringify(message.say)}`);
      if (options.logSteps && message.kind === 'action') log(`action ${JSON.stringify(message.action)}`);
      if (message.kind === 'consent') {
        if (message.text === null) consentCard?.hide();
        else consentCard?.show(displayId, message.text);
        return;
      }
      overlays.send(displayId, message);
    },
    log,
    logText: options.logSteps,
    micWindowMs: settings.micWindowMs,
    onReport: (report) => {
      if (!options.exitAfterChord && options.detailAfter === undefined) return;
      if (report.endMs === undefined && !report.error) return;
      if (reported.has(report)) return;
      reported.add(report);
      // Checks: ask for more detail once, a while after the page has finished showing the first answer (where its button appears).
      if (options.detailAfter !== undefined && !report.detail && !report.error) {
        answerEnded = true;
        askDetail();
      }
      if (options.exitAfterChord && ++chordsDone >= options.exitAfterChord) setTimeout(quit, (report.error ? 3 : options.settleSeconds) * 1000);
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
    controlHelper?.stop();
    consentCard?.dispose();
    overlays.setPen(null);
    overlays.dispose();
    media.dispose();
    settingsWindow.dispose();
    frontReader.dispose();
    tray.destroy();
    // Let the model's process end (and its working folder go) before we leave, but never hang on it.
    void Promise.race([Promise.all([model.close?.(), detailModel?.close?.()]), new Promise((r) => setTimeout(r, 3000))]).finally(() => app.exit(0));
  };
  let quitting = false;
  const tray = createTray({
    onQuit: quit,
    onClear: () => {
      overlays.clearAll();
      session?.reset();
    },
    onPlaySample: () => playSample(screen.getPrimaryDisplay().id),
    onSettings: () => settingsWindow.open(),
    hotkeyLabel: chord.label,
    onPin: () => session?.pin(displayUnderPointer().id),
    onOpenPins: () => {
      mkdirSync(pins.dir, { recursive: true });
      void shell.openPath(pins.dir);
    },
    pinScreenshot: () => prefs.get().pinScreenshot,
    onPinScreenshot: (on) => prefs.set({ pinScreenshot: on }),
    ...(navConsent
      ? {
        guideActions: {
          paused: () => navConsent.paused(),
          setPaused: (on: boolean) => navConsent.setPaused(on),
          asking: () => navConsent.pending(),
          answer: (yes: boolean) => void navConsent.answer(yes),
        },
      }
      : {}),
  });
  navConsent?.onChange(() => tray.refresh());

  let hotkey: ReturnType<typeof startHotkey> | null = null;
  if (!options.noHotkey) {
    try {
      hotkey = startHotkey({
        arm: () => session?.arm(),
        cancel: () => session?.cancel(),
        start: () => {
          log('chord pressed');
          session?.start();
          if (options.fakeStroke) {
            const points = options.fakeStroke;
            const displayId = displayUnderPointer().id;
            setTimeout(() => session?.stroke(displayId, { id: 1, points, done: true }), 300);
          }
        },
        stop: () => {
          frames?.start();
          session?.stop();
        },
      }, chord);
    } catch (error) {
      log(`the key hook could not start: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  log(hotkey ? `ready: hold ${chord.label}` : 'ready (hotkey off)');

  if (options.playSample) playSample(screen.getPrimaryDisplay().id);
  if (options.selfChord) {
    // Check only: press and release the chord through the hook itself, once.
    const press = (holdMs: number) => {
      uIOhook.keyToggle(chord.lead, 'down');
      uIOhook.keyToggle(chord.second, 'down');
      setTimeout(() => {
        uIOhook.keyToggle(chord.second, 'up');
        uIOhook.keyToggle(chord.lead, 'up');
      }, holdMs);
    };
    // One press per question asked for (two by default); a further press would stop an answer still arriving.
    const presses = options.detailAfter !== undefined ? 1 : options.exitAfterChord || 2;
    for (let i = 0; i < presses; i++) setTimeout(() => press(options.chordHoldMs), 2500 + i * (options.chordHoldMs + 6000));
  }
  if (options.maxSeconds) setTimeout(quit, options.maxSeconds * 1000);
}

main().catch((error) => {
  console.error(`[talkthrough] ${error instanceof Error ? error.message : String(error)}`);
  app.exit(1);
});
