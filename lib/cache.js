const Tree = require('functional-red-black-tree')
const Account = require('ethereumjs-account')
const async = require('async')

var Cache = module.exports = function (trie) {
  this._cache = Tree()
  this._checkpoints = []
  this._deletes = []
  this._trie = trie
}

Cache.prototype.put = function (key, val, fromTrie) {
  var exists
  if (val.exists) {
    exists = val.exists
  } else {
    exists = true
  }

  var modified = !fromTrie
  key = key.toString('hex')
  var it = this._cache.find(key)
  if (it.node) {
    this._cache = it.update({
      val: val,
      modified: modified,
      exists: true
    })
  } else {
    this._cache = this._cache.insert(key, {
      val: val,
      modified: modified,
      exists: exists
    })
  }
}

// returns the queried account or an empty account
Cache.prototype.get = function (key) {
  var account = this.lookup(key)
  if (!account) {
    account = new Account()
    account.exists = false
  }
  return account
}

// returns the queried account or undefined
Cache.prototype.lookup = function (key) {
  key = key.toString('hex')

  var it = this._cache.find(key)
  if (it.node) {
    var account = new Account(it.value.val)
    account.exists = it.value.exists
    return account
  }
}

Cache.prototype._lookupAccount = function (address, cb) {
  var self = this
  self._trie.get(address, function (err, raw) {
    if (err) return cb(err)
    var account = new Account(raw)
    var exists = !!raw
    account.exists = exists
    cb(null, account, exists)
  })
}

Cache.prototype.getOrLoad = function (key, cb) {
  var self = this
  var account = this.lookup(key)
  if (account) {
    cb(null, account)
  } else {
    self._lookupAccount(key, function (err, account, exists) {
      if (err) return cb(err)
      // ugly manual cache insertion
      self._cache = self._cache.insert(key.toString('hex'), {
        val: account,
        modified: false,
        exists: exists
      })
      cb(null, account)
    })
  }
}

Cache.prototype.warm = function (addresses, cb) {
  var self = this
  // shim till async supports iterators
  var accountArr = []
  addresses.forEach(function (val) {
    if (val) accountArr.push(val)
  })

  async.eachSeries(accountArr, function (addressHex, done) {
    var address = new Buffer(addressHex, 'hex')
    self._lookupAccount(address, function (err, account) {
      self._cache = self._cache.insert(addressHex, {
        val: account,
        modified: false,
        exists: account.exists
      })

      done(err)
    })
  }, cb)
}

Cache.prototype.flush = function (cb) {
  var it = this._cache.begin
  var self = this
  var next = true
  async.whilst(function () {
    return next
  }, function (done) {
    if (it.value.modified) {
      it.value.modified = false
      it.value.val = it.value.val.serialize()
      self._trie.put(new Buffer(it.key, 'hex'), it.value.val, function () {
        next = it.hasNext
        it.next()
        done()
      })
    } else {
      next = it.hasNext
      it.next()
      done()
    }
  }, function () {
    async.eachSeries(self._deletes, function (address, done) {
      self._trie.del(address, done)
    }, function () {
      self._deletes = []
      cb()
    })
  })
}

Cache.prototype.checkpoint = function () {
  this._checkpoints.push(this._cache)
}

Cache.prototype.revert = function () {
  this._cache = this._checkpoints.pop(this._cache)
}

Cache.prototype.commit = function () {
  this._checkpoints.pop()
}

Cache.prototype.clear = function () {
  this._deletes = []
  this._cache = Tree()
}

Cache.prototype.del = function (key) {
  this._deletes.push(key)
  key = key.toString('hex')
  this._cache = this._cache.remove(key)
}