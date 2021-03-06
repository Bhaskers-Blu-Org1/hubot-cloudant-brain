// Description:
//   hubot-ibmcloudant-brain
//
// Configuration:
//   CLOUDANT_URL
//
// Author:
//   Rophy Tsai <tsaiyl@tw.ibm.com>

const Cloudant = require('cloudant');
const url = require('url');
const _ = require('lodash');

module.exports = (robot) => {
  
  let dbName = null;
  let db = null;
  let cache = {};
  let rev = {};

  function load(err, cloudant) {
      if (err) return console.error(err);
      dbName = dbName || 'hubot';
      db = cloudant.db.use(dbName);
      robot.logger.info('hubot-ibmcloudant-brain: connected to db: ' + dbName);
      robot.brain.setAutoSave(false);
      
      let _private = {};

      function list(offset) {
        db.list({include_docs:true, skip:offset, limit:100}, (err, docs) => {
          if (err) throw err;
          // docs = {
          //   offset: 0,
          //   total_rows: 10000,
          //   rows: [ { id: 'id', key: 'id', value: { rev: 'rev' }, doc: { _id: 'id', _rev: 'rev', ... } }, ... ]
          // }
          docs.rows.forEach(doc => {
            if (!doc.deleted) _private[doc.id] = doc.doc.value;
            rev[doc.id] = doc.doc._rev;
          });
          offset += docs.rows.length;
          if (offset >= docs.total_rows) process(offset);
          else list(offset);
        });
      }

      function process(total) {
        cache = _.cloneDeep(_private);
        robot.brain.mergeData({_private: _private});
        robot.brain.setAutoSave(true);
        robot.brain.resetSaveInterval(30);
        robot.logger.info('hubot-ibmcloudant-brain: loaded ' + total + ' records.');
        robot.brain.emit('connected');
      }

      list(0);
      
  }

  robot.brain.on('save', (data) => {
    if (!db) return console.error('ERROR: hubot-ibmcloudant-brain still not ready to save');
    let docs = [];


    let changes = {};
    let deletes = {};

    for(let key in data._private) {
      if (data._private[key] === null || data._private[key] === undefined) {
        delete data._private[key];
        continue;
      }
      if (!_.isEqual(cache[key], data._private[key])) {
        changes[key] = _.cloneDeep(data._private[key]);
        docs.push({ _id: key, _rev: rev[key], value: changes[key]});
      }
    }
    for(let key in cache) {
      if (data._private[key] === null || data._private[key] === undefined) {
        deletes[key] = true;
        docs.push({ _id: key, _rev: rev[key], _deleted: true});        
      }
    }

    robot.logger.debug('hubot-ibmcloudant-brain: ' + docs.length + ' new or updated records.');
    if (docs.length === 0) return;
    db.bulk({docs:docs}, (err, results) => {
      if (err) return console.error('ERROR: hubot-ibmcloudant-brain failed to save data', err);
      robot.logger.debug('hubot-ibmcloudant-brain: saved ' + results.length + ' records.');
      results.forEach((doc) => {
        if (!doc.ok) console.error('ERROR', doc);
        if (deletes[doc.id]) {
          delete rev[doc.id];
          delete cache[doc.id];
        } else {
          rev[doc.id] = doc.rev;
          cache[doc.id] = changes[doc.id];
        }
      });
      robot.brain.emit('saved');
    });

  
  });
  
  
  // Check for old URL syntax.
  if (process.env.CLOUDANT_DB) dbName = process.env.CLOUDANT_DB;
  if (process.env.CLOUDANT_URL) {
    let match = process.env.CLOUDANT_URL.match(/^(https?:\/\/.+)\/(.+)$/);
    let url = match ? match[1] : process.env.CLOUDANT_URL;
    dbName = match ? match[2] : dbName;
    Cloudant(url, load);
  } else if (process.env.VCAP_SERVICES) Cloudant({ vcapServices: JSON.parse(process.env.VCAP_SERVICES) }, load);
  else console.error('hubot-ibmcloudant-brain: missing env var CLOUDANT_URL');

}