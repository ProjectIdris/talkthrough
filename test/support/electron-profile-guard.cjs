const { app, session } = require('electron');
const path = require('node:path');
const os = require('node:os');

// Fail before ready unless Electron itself selected the intended temporary profile.
module.exports = function guardProfile(expected, report) {
  const norm = p => typeof p === 'string' && p ? path.resolve(p).toLowerCase() : '';
  const target = norm(expected);
  const temp = norm(os.tmpdir());
  const relative = target && path.relative(temp, target);
  const isScratch = relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
  const userData = app.getPath('userData');
  const sessionData = app.getPath('sessionData');
  if (!isScratch || app.isReady() || norm(app.commandLine.getSwitchValue('user-data-dir')) !== target || norm(userData) !== target || norm(sessionData) !== target) {
    console.error('profile mismatch before ready');
    process.exit(23);
  }
  app.once('ready', () => {
    const storage = session.defaultSession.getStoragePath();
    if (norm(app.getPath('userData')) !== target || norm(app.getPath('sessionData')) !== target || norm(storage) !== target) {
      console.error('profile mismatch at ready');
      process.exit(24);
    }
    report({ preReady: true, userData, sessionData, storage });
  });
};
