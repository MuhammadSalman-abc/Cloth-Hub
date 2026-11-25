const session = require('express-session');
const mongoose = require('mongoose');

class MongoSessionStore extends session.Store {
  constructor() {
    super();
    this.indexPromise = null;
  }

  collection() {
    if (!mongoose.connection.db) throw new Error('MongoDB session store is not connected.');
    return mongoose.connection.db.collection('sessions');
  }

  ensureExpiryIndex(collection) {
    if (!this.indexPromise) {
      this.indexPromise = collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
        .catch(error => {
          this.indexPromise = null;
          throw error;
        });
    }
    return this.indexPromise;
  }

  expiry(sessionData) {
    const value = sessionData?.cookie?.expires;
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  get(sid, callback) {
    const collection = this.collection();
    this.ensureExpiryIndex(collection)
      .then(() => collection.findOne({ _id: sid }))
      .then(async record => {
        if (!record) return callback(null, null);
        if (record.expiresAt && record.expiresAt <= new Date()) {
          await collection.deleteOne({ _id: sid });
          return callback(null, null);
        }
        try {
          callback(null, JSON.parse(record.session));
        } catch (error) {
          callback(error);
        }
      })
      .catch(callback);
  }

  set(sid, sessionData, callback = () => {}) {
    const collection = this.collection();
    const expiresAt = this.expiry(sessionData);
    const update = { session: JSON.stringify(sessionData) };
    if (expiresAt) update.expiresAt = expiresAt;
    this.ensureExpiryIndex(collection)
      .then(() => collection.updateOne(
        { _id: sid },
        { $set: update, ...(expiresAt ? {} : { $unset: { expiresAt: '' } }) },
        { upsert: true }
      ))
      .then(() => callback(null))
      .catch(callback);
  }

  touch(sid, sessionData, callback = () => {}) {
    const collection = this.collection();
    const expiresAt = this.expiry(sessionData);
    const update = expiresAt ? { $set: { expiresAt } } : { $unset: { expiresAt: '' } };
    collection.updateOne({ _id: sid }, update).then(() => callback(null)).catch(callback);
  }

  destroy(sid, callback = () => {}) {
    this.collection().deleteOne({ _id: sid }).then(() => callback(null)).catch(callback);
  }

  clear(callback = () => {}) {
    this.collection().deleteMany({}).then(() => callback(null)).catch(callback);
  }
}

module.exports = MongoSessionStore;
