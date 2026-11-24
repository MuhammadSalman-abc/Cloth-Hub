const session = require('express-session');
const fs = require('fs');

class LocalSessionStore extends session.Store {
  constructor(filePath) {
    super();
    this.filePath = filePath;
    this.sessions = new Map();
    try {
      const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      for (const [sid, value] of Object.entries(saved)) {
        if (this.isAlive(value)) this.sessions.set(sid, value);
      }
      this.persist();
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) console.error('Could not load saved sessions:', error.message);
    }
  }

  isAlive(value) {
    const expires = value && value.cookie && value.cookie.expires;
    return !expires || new Date(expires).getTime() > Date.now();
  }

  persist() {
    const data = Object.fromEntries(this.sessions);
    fs.writeFileSync(this.filePath, JSON.stringify(data), 'utf8');
  }

  get(sid, callback) {
    const value = this.sessions.get(sid);
    if (!value || !this.isAlive(value)) {
      this.sessions.delete(sid);
      callback(null, null);
      return;
    }
    callback(null, JSON.parse(JSON.stringify(value)));
  }

  set(sid, value, callback = () => {}) {
    this.sessions.set(sid, value);
    try { this.persist(); callback(null); } catch (error) { callback(error); }
  }

  touch(sid, value, callback = () => {}) {
    if (this.sessions.has(sid)) this.sessions.set(sid, value);
    try { this.persist(); callback(null); } catch (error) { callback(error); }
  }

  destroy(sid, callback = () => {}) {
    this.sessions.delete(sid);
    try { this.persist(); callback(null); } catch (error) { callback(error); }
  }

  clear(callback = () => {}) {
    this.sessions.clear();
    try { this.persist(); callback(null); } catch (error) { callback(error); }
  }
}

module.exports = LocalSessionStore;
