import { app, dialog, safeStorage, screen, shell } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { isCheckRun, parseArgs, wantsSoftware } from './args.ts';
import { createHttpBackend } from '../adapters/backend.ts';
import { createClaudeModel } from '../adapters/claude-model.ts';
import { createCodexModel } from '../adapters/codex-model.ts';
import { createSpeechService } from './speech-service.ts';
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
import { parseHotkey, pressChord } from './chord.ts';
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
import { createVoiceBridge, createVoiceWaker } from './voice-bridge.ts';
import { createStageModel } from '../adapters/stage-model.ts';
import { createRecorder, recordedVoice, replayModel, runDrive, saveVoice, tapeModel } from './showcase.ts';
import { createLoopback } from './loopback.ts';
import type { DriveStep } from './showcase.ts';
import { createNavigator } from './nav.ts';
import { createHelper } from './ps-helper.ts';
import { createUiaReader, toDisplayBoxes } from './uia.ts';
import { DETAIL_EFFORT, DETAIL_MODELS, DETAIL_TIMEOUT_MS, loadSettings } from './settings.ts';
import { createTray } from './tray.ts';
import { createQuestionRecord, recordDir } from './record.ts';
import { observeModel } from './record-model.ts';

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

// The graphics card draws the overlay by default; with none, Chromium falls back to its software rasteriser by itself.
// `--software` (or TALKTHROUGH_SOFTWARE=1) forces the software path. `--gpu` / TALKTHROUGH_GPU=1 are the old explicit switch and now change nothing.
if (wantsSoftware(options)) app.disableHardwareAcceleration();
if (options.grab && options.grab.scaleFactor !== 1) app.commandLine.appendSwitch('force-device-scale-factor', String(options.grab.scaleFactor));
if (options.fakeMic) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
  if (options.fakeMicFile) app.commandLine.appendSwitch('use-file-for-fake-audio-capture', options.fakeMicFile);
}

const startedAt = performance.now();
/** Where every log line is also sent while the record of questions is on (set once the settings are read). */
let lineSink: ((line: string) => void) | undefined;
const log = (message: string) => {
  console.log(`[talkthrough +${((performance.now() - startedAt) / 1000).toFixed(2)}s] ${message}`);
  lineSink?.(message);
};

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
  // The record of each question, when the person has switched it on: a folder for every question, beside whatever the log says. It is a setting, not a check run.
  const record = settings.keepRecord ? createQuestionRecord({ dir: recordDir(settings.recordFolder, app.getPath('userData')), warn: (m) => console.error(`[talkthrough] ${m}`) }) : undefined;
  if (record) {
    lineSink = (line) => {
      record.line(line);
      if (/^voice/.test(line)) record.voice(line);
    };
    log(`record of questions: on, in ${recordDir(settings.recordFolder, app.getPath('userData'))}`);
  }
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
  // With text only nothing is spoken, so no voice server is asked and no system voice is used.
  const voice = (settings.voiceServerUrl || options.voiceDir) && !options.silentVoice && settings.captions !== 'text'
    ? {
      bridge: ((bridge) => (options.saveVoice ? saveVoice(bridge, options.saveVoice, log) : bridge))(options.voiceDir ? recordedVoice(options.voiceDir, log) : createVoiceBridge({ url: settings.voiceServerUrl!, ...(settings.voiceServerVoice ? { voice: settings.voiceServerVoice } : {}), timeoutMs: settings.voiceTimeoutMs, log })),
      firstAudioMs: settings.voiceFirstAudioMs,
      cooldownMs: settings.voiceCooldownMs,
    }
    : undefined;
  // The voice server is woken with the recogniser when they share a warm-up route, and by its own otherwise.
  const voiceWaker = voice && settings.voiceServerUrl && !options.voiceDir ? createVoiceWaker({ speakUrl: settings.voiceServerUrl, ...(settings.speechServerUrl ? { except: `${settings.speechServerUrl.replace(/\/+$/, '')}/warm` } : {}), log }) : undefined;
  const overlays = createOverlayManager({
    preload,
    page: overlayPage,
    ...(options.backdrop ? { backdrop: options.backdrop } : {}),
    hideFromCapture: !options.visibleToCapture,
    hidden: options.hidden,
    globalKeys: !isCheckRun(options),
    silent: options.silentVoice,
    captions: settings.captions,
    ...(options.windowSize ? { size: options.windowSize } : {}),
    ...(options.record && !options.recordAudio ? { muted: true } : {}),
    ...(voice ? { voice } : {}),
    onReady: log,
    ...(record
      ? {
        onPageLine: (line: string, level: 'info' | 'warning' | 'error') => {
          record.line(`page ${level}: ${line}`);
          if (/^voice/.test(line)) record.voice(line);
          if (level === 'error') record.error(`overlay page: ${line}`);
        },
      }
      : {}),
    onDone: () => {
      session?.done();
      pageDone = true;
      askDetail();
    },
    onStroke: (displayId, stroke) => session?.stroke(displayId, stroke),
    onCancel: (displayId, released) => session?.cancelQuestion(displayId, released),
    onEscape: () => pressEscape(),
    answerBusy: () => session?.busy() === true,
    onOffer: (displayId) => void session?.offer(displayId),
    ...(settings.detailRoute ? { onDetail: (displayId: number) => void session?.detail(displayId) } : {}),
    onMilestone: (m) => session?.milestone(m),
  });
  /** Escape: the question being asked is cancelled, or the answer stopped and its drawing faded away. */
  function pressEscape(): void {
    const what = session?.escape() ?? 'nothing';
    if (what !== 'cancelled') overlays.dismissAll();
    overlays.refreshEscape();
  }
  overlays.start();
  const media = createMedia({ preload: audioPreload, page: audioPage });
  void media.warm();

  // How a question is heard: a speech server of the person's own, whisper.cpp once they have agreed to download it, else the recogniser Windows has.
  const speechService = createSpeechService({ dir: join(app.getPath('userData'), 'speech'), ...(settings.speechServerUrl ? { speechServerUrl: settings.speechServerUrl } : {}), ...(settings.speechLimitMs ? { speechLimitMs: settings.speechLimitMs } : {}) });
  const fixedQuestion = options.question;
  // "one || two": a different text for each question, the last one repeating
  const fixedTexts = (fixedQuestion ?? '').split('||').map((t) => t.trim());
  let spoken = 0;
  const speech: SpeechToText | null = fixedQuestion
    ? { id: 'fixed-text', transcribe: async () => ({ text: fixedTexts[Math.min(spoken++, fixedTexts.length - 1)] as string }) } // checks only: skips the speech server
    : speechService.engine;
  if (fixedQuestion) log('question text fixed for this run (no recogniser used)');
  else void speechService.status().then((s) => log(s.order.length > 0 ? `hearing: ${s.order.join(', then ')}` : 'no way to hear a question is set up'), () => undefined);

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
    speech: speechService,
    settings: createSettingsService({ path: settingsPath, warn: (m) => log(`settings: ${m}`) }),
    onRestart: () => {
      app.relaunch();
      quit();
    },
  });
  const chord = parseHotkey(settings.hotkey) ?? parseHotkey('right-ctrl+right-shift')!;

  /** One route's model, locked down the same way whichever it is; the detail pass uses the same code with its own choices. */
  const makeModel = (route: 'codex' | 'claude' | 'openai', name: string, effort: string, quick: boolean, chain = false): Model => {
    const made = makeRouteModel(route, name, effort, quick, chain);
    return observeModel(made, { ...(record ? { record } : {}), log }, quick ? (chain ? 'a step' : 'quick answer') : 'detail pass');
  };
  const makeRouteModel = (route: 'codex' | 'claude' | 'openai', name: string, effort: string, quick: boolean, chain = false): Model => route === 'claude'
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
  const firstModel = makeModel(settings.model, settings.model === 'claude' ? settings.claudeModel : settings.model === 'openai' ? settings.openaiModel : settings.codexModel, settings.effort, true, split === 'steps');
  // Two models for one answer (claude route, a step at a time, only when the settings name a second): step 1 from the first, the steps after it from the other.
  const realModel = split === 'steps' && settings.claudeLaterModel ? createStageModel(firstModel, makeModel('claude', settings.claudeLaterModel, settings.effort, true, true)) : firstModel;
  // Recording (development): the answer can be written to a tape as it comes, or played back from one with its own timing.
  const quickModel: Model = options.replayAnswer ? replayModel(options.replayAnswer, log) : options.saveAnswer ? tapeModel(realModel, options.saveAnswer, log) : realModel;
  const model: Model = split === 'two' ? createTwoStepModel(quickModel, { log, early: process.env.EXPLAINER_TWO_EARLY === '1' /* tried, not yet a setting: see the Two Call note */ }) : split === 'steps' ? createStepByStepModel(quickModel, { log }) : quickModel;
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
  /** Recording: the script is run once, after the first answer (a detail pass that follows reports again, and does not start it over). */
  let driven = false;
  let detailAsked = false;
  let answerEnded = false;
  let pageDone = false;
  const askDetail = (): void => {
    if (options.detailAfter === undefined || detailAsked || !answerEnded || !pageDone) return;
    detailAsked = true;
    setTimeout(() => void session?.detail(displayUnderPointer().id), options.detailAfter * 1000);
  };
  // Recording (development): the overlay window's picture goes to ffmpeg from the chord press; the file beside it says when it began.
  const recorder = options.record && options.ffmpeg && options.windowSize
    ? createRecorder({ source: () => overlays.frame(overlays.displayIds()[0] ?? -1), width: options.windowSize.width, height: options.windowSize.height, fps: options.recordFps, file: options.record, ffmpeg: options.ffmpeg, log })
    : null;
  if (options.record && !recorder) log('record: needs --ffmpeg <executable> and --window-size WxH');
  const loopback = options.recordAudio ? createLoopback(log) : null;
  let loopbackBegan: Promise<number> | undefined;
  const finishRun = (): void => {
    if (!recorder) return quit();
    void recorder.stop().then(async (first) => {
      const sound = loopback ? await loopback.stop().catch(() => null) : null;
      if (sound && options.recordAudio) writeFileSync(options.recordAudio, sound);
      const soundBegan = loopbackBegan ? await loopbackBegan.catch(() => undefined) : undefined;
      writeFileSync(`${options.record}.json`, JSON.stringify({ firstFrameEpoch: first, ...(soundBegan !== undefined ? { soundEpoch: soundBegan } : {}), appStartEpoch: Math.round(Date.now() - (performance.now() - startedAt)) }));
      quit();
    });
  };
  const drive: DriveStep[] | null = options.drive ? (JSON.parse(readFileSync(options.drive, 'utf8')) as DriveStep[]) : null;
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
      crop: async (grabId, box) => {
        const c = await media.crop(grabId, box);
        if (c && options.savePen) {
          mkdirSync(options.savePen, { recursive: true });
          writeFileSync(join(options.savePen, 'picture-crop.png'), Buffer.from(c.base64, 'base64'));
        }
        return c;
      },
      compose: async (grabId, strokes) => {
        const c = await media.compose(grabId, strokes, settings.screenshotEdge);
        if (options.savePen) {
          mkdirSync(options.savePen, { recursive: true });
          writeFileSync(join(options.savePen, 'pen-full.png'), Buffer.from(c.screenshot.base64, 'base64'));
          c.focus.forEach((f, k) => writeFileSync(join(options.savePen as string, `pen-crop${c.focus.length > 1 ? `-${k + 1}` : ''}.png`), Buffer.from(f.crop.base64, 'base64')));
        }
        log(`pen: ${strokes.length} stroke(s), full ${c.screenshot.width}x${c.screenshot.height}, ${c.focus.map((f) => `${f.kind} crop ${f.crop.width}x${f.crop.height} (box ${Math.round(f.box.x)},${Math.round(f.box.y)} ${Math.round(f.box.w)}x${Math.round(f.box.h)})`).join('; ')}`);
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
    ...(record ? { record } : {}),
    ...(voiceWaker ? { wakeVoice: () => voiceWaker.wake() } : {}),
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
      if (options.exitAfterChord && ++chordsDone >= options.exitAfterChord && !(drive && driven)) {
        if (drive && !report.error) {
          driven = true;
          // Recording: a while after the answer, the scripted mouse (turn the model, Explode, Cut), then the settle, then the end.
          setTimeout(() => {
            const id = overlays.displayIds()[0] ?? -1;
            void runDrive({ input: (e) => overlays.input(id, e), press: (name) => overlays.press(id, name === 'cut' ? 'cut' : name === 'detail' ? 'detail' : 'explode'), rectOf: (name) => overlays.rectOf(id, name) }, drive, log)
              .catch((e: unknown) => log(`drive: ${String(e)}`))
              .then(() => setTimeout(finishRun, options.settleSeconds * 1000));
          }, options.driveAfter * 1000);
        } else setTimeout(finishRun, (report.error ? 3 : options.settleSeconds) * 1000);
      }
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
    void Promise.race([Promise.all([model.close?.(), detailModel?.close?.(), speechService.engine.close?.()]), new Promise((r) => setTimeout(r, 3000))]).finally(() => app.exit(0));
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
          if (loopback && !loopbackBegan) loopbackBegan = loopback.start();
          recorder?.start();
          session?.start();
          overlays.refreshEscape();
          if (options.fakeStroke) {
            const strokes = options.fakeStroke;
            const displayId = displayUnderPointer().id;
            strokes.forEach((points, k) => setTimeout(() => session?.stroke(displayId, { id: k + 1, points, done: true }), 300 + 60 * k));
          }
        },
        stop: () => {
          frames?.start();
          session?.stop();
        },
      }, chord, () => pressEscape());
    } catch (error) {
      log(`the key hook could not start: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  log(hotkey ? `ready: hold ${chord.label}` : 'ready (hotkey off)');

  if (options.playSample) playSample(screen.getPrimaryDisplay().id);
  if (options.selfChord) {
    // Check only: make the chord by feeding the app's own chord tracker, the path the key hook calls; nothing is sent to the system.
    const press = (holdMs: number) => {
      if (hotkey) pressChord(hotkey.tracker, chord, holdMs);
      else log('self-chord: the key hook is not running, so there is no chord tracker to feed');
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
