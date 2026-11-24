const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const User = require('../models/User');

const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const entry = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (entry && process.env[entry[1]] === undefined) process.env[entry[1]] = entry[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
if (!email) { console.error('Set ADMIN_EMAIL in .env first.'); process.exit(1); }

mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/jeansStore')
  .then(async () => {
    const user = await User.findOneAndUpdate({ email }, { $set: { role: 'admin' } }, { returnDocument: 'after' });
    if (!user) {
      console.error('No account exists for ADMIN_EMAIL. Register and log in with that email, then run this command again.');
      process.exitCode = 1;
      return;
    }
    console.log('Admin role enabled for the configured account.');
  })
  .catch(error => { console.error('Could not enable admin role:', error.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
