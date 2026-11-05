const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
app.setName('Talkthrough');
require('./electron-profile-guard.cjs')(process.env.TT_GRAB_EXPECTED_PROFILE, receipt => {
  fs.writeFileSync(process.env.TT_GRAB_PROFILE_RECEIPT, JSON.stringify(receipt));
});
require(path.resolve('dist/main/main.cjs'));
