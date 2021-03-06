'use strict';

var util = require('util'),
  Store = require('../base'),
  _ = require('lodash'),
  debug = require('debug')('eventstore:store:inmemory');

function InMemory(options) {
  Store.call(this, options);
  this.store = {};
  this.snapshots = {};
}

util.inherits(InMemory, Store);

function deepFind (obj, pattern) {
  var found;

  if (pattern) {
    var parts = pattern.split('.');

    found = obj;
    for (var i in parts) {
      found = found[parts[i]];
      if (_.isArray(found)) {
        found = _.filter(found, function (item) {
          var deepFound = deepFind(item, parts.slice(i + 1).join('.'));
          return !!deepFound;
          
        });
        break;
      }

      if (!found) {
        break;
      }
    }
  }

  return found;
}

_.extend(InMemory.prototype, {

  connect: function (callback) {
    this.emit('connect');
    if (callback) callback(null, this);
  },

  disconnect: function (callback) {
    this.emit('disconnect');
    if (callback) callback(null);
  },
  
  clear: function (callback) {
    this.store = {};
    this.snapshots = {};
    if (callback) callback(null);
  },

  addEvents: function (events, callback) {
    if (!events || events.length === 0) {
      callback(null);
      return;
    }
    
    var found = _.find(events, function(evt) {
      return !evt.aggregateId;
    });
    
    if (found) {
      var errMsg = 'aggregateId not defined!';
      debug(errMsg);
      if (callback) callback(new Error(errMsg));
      return;
    }

    var aggregateId = events[0].aggregateId;
    var aggregate = events[0].aggregate || '_general';
    var context = events[0].context || '_general';

    this.store[context] = this.store[context] || {};
    this.store[context][aggregate] = this.store[context][aggregate] || {};

    this.store[context][aggregate][aggregateId] = this.store[context][aggregate][aggregateId] || [];

    this.store[context][aggregate][aggregateId] = this.store[context][aggregate][aggregateId].concat(events);

    callback(null);
  },

  getEvents: function (query, skip, limit, callback) {
    var res = [];
    for (var s in this.store) {
      for (var ss in this.store[s]) {
        for (var sss in this.store[s][ss]) {
          res = res.concat(this.store[s][ss][sss]);
        }
      }
    }

    res = _.sortBy(res, function (e) {
      return e.commitStamp.getTime();
    });

    if (!_.isEmpty(query)) {
      res = _.filter(res, function(e) {
        var keys = _.keys(query);
        var values = _.values(query);
        var found = false;
        for (var i in keys) {
          var key = keys[i];
          var deepFound = deepFind(e, key);
          if (_.isArray(deepFound) && deepFound.length > 0) {
            found = true;
          } else if (deepFound === values[i]) {
            found = true;
          } else {
            found = false;
            break;
          }
        }
        return found;
      });
    }
    
    if (limit === -1) {
      return callback(null, res.slice(skip));
    }

    if (res.length <= skip) {
      return callback(null, []);
    }
    
    callback(null, res.slice(skip, skip + limit));
  },

  getEventsByRevision: function (query, revMin, revMax, callback) {
    var res = [];

    if (!query.aggregateId) {
      var errMsg = 'aggregateId not defined!';
      debug(errMsg);
      if (callback) callback(new Error(errMsg));
      return;
    }
    
    if (query.context && query.aggregate) {
      this.store[query.context] = this.store[query.context] || {};
      this.store[query.context][query.aggregate] = this.store[query.context][query.aggregate] || {};

      if (!this.store[query.context][query.aggregate][query.aggregateId]) {
        return callback(null, res);
      }
      else {
        if (revMax === -1) {
          res = res.concat(this.store[query.context][query.aggregate][query.aggregateId].slice(revMin));
        }
        else {
          res = res.concat(this.store[query.context][query.aggregate][query.aggregateId].slice(revMin, revMax));
        }
      }
      return callback(null, res);
    }

    if (!query.context && query.aggregate) {
      for (var s in this.store) {
        var c = this.store[s];
        if (c[query.aggregate] && c[query.aggregate][query.aggregateId]) {
          if (revMax === -1) {
            res = res.concat(c[query.aggregate][query.aggregateId].slice(revMin));
          }
          else {
            res = res.concat(c[query.aggregate][query.aggregateId].slice(revMin, revMax));
          }
        }
      }
      return callback(null, res);
    }

    if (query.context && !query.aggregate) {
      var cc = this.store[query.context] || {};
      for (var ss in cc) {
        var a = cc[ss];
        if (a[query.aggregateId]) {
          if (revMax === -1) {
            res = res.concat(a[query.aggregateId].slice(revMin));
          }
          else {
            res = res.concat(a[query.aggregateId].slice(revMin, revMax));
          }
        }
      }
      return callback(null, res);
    }

    if (!query.context && !query.aggregate) {
      for (var sc in this.store) {
        var cont = this.store[sc];
        for (var sa in cont) {
          var agg = cont[sa];
          if (agg[query.aggregateId]) {
            if (revMax === -1) {
              res = res.concat(agg[query.aggregateId].slice(revMin));
            }
            else {
              res = res.concat(agg[query.aggregateId].slice(revMin, revMax));
            }
          }
        }
      }
      return callback(null, res);
    }
  },

  getUndispatchedEvents: function (callback) {
    var res = [];

    this.getEvents({}, 0, -1, function (err, evts) {
      for (var ele in evts) {
        var evt = evts[ele];
        if (!evt.dispatched) {
          res.push(evt);
        }
      }
      callback(null, res);
    });
  },

  setEventToDispatched: function (id, callback) {
    var res;

    this.getEvents({ id: id }, 0, -1, function (err, evts) {
      if (evts && evts.length > 0) {
        res = evts[0];
      }
      
      res.dispatched = true;

      callback(null);
    });
  },

  addSnapshot: function(snap, callback) {
    var aggregateId = snap.aggregateId;
    var aggregate = snap.aggregate || '_general';
    var context = snap.context || '_general';
    
    if (!snap.aggregateId) {
      var errMsg = 'aggregateId not defined!';
      debug(errMsg);
      if (callback) callback(new Error(errMsg));
      return;
    }

    this.snapshots[context] = this.snapshots[context] || {};
    this.snapshots[context][aggregate] = this.snapshots[context][aggregate] || {};
    this.snapshots[context][aggregate][aggregateId] = this.snapshots[context][aggregate][aggregateId] || [];

    this.snapshots[context][aggregate][aggregateId].push(snap);
    callback(null);
  },

  getSnapshot: function (query, revMax, callback) {

    if (!query.aggregateId) {
      var errMsg = 'aggregateId not defined!';
      debug(errMsg);
      if (callback) callback(new Error(errMsg));
      return;
    }

    var all = [];
    for (var s in this.snapshots) {
      for (var ss in this.snapshots[s]) {
        for (var sss in this.snapshots[s][ss]) {
          all = all.concat(this.snapshots[s][ss][sss]);
        }
      }
    }

//    all = _.sortBy(all, function (s) {
//      return [(-s.revision), (-s.version)].join('_');
//    });

    all = _.sortBy(all, function (s) {
      return (-s.commitStamp.getTime());
    });
    
    if (!_.isEmpty(query)) {
      all = _.filter(all, function(a) {
        var keys = _.keys(query);
        var values = _.values(query);
        var found = false;
        for (var i in keys) {
          var key = keys[i];
          var deepFound = deepFind(a, key);
          if (_.isArray(deepFound) && deepFound.length > 0) {
            found = true;
          } else if (deepFound === values[i]) {
            found = true;
          } else {
            found = false;
            break;
          }
        }
        return found;
      });
    }

    if (revMax === -1) {
      return callback(null, all[0]);
    }
    else {
      for (var i = all.length - 1; i >= 0; i--) {
        if (all[i].revision <= revMax) {
          return callback(null, all[i]);
        }
      }
    }
    callback(null, null);
  }

});

module.exports = InMemory;
