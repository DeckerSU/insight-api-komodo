"use strict";

var bitcore = require("bitcore-lib-komodo");
var async = require("async");
var TxController = require("./transactions");
var Common = require("./common");
var getKomodoRewards = require("./get-komodo-rewards");
var moment = require("moment");

function AddressController(node) {
  this.node = node;
  this.txController = new TxController(node);
  this.common = new Common({ log: this.node.log });
}

AddressController.prototype.show = function (req, res) {
  var self = this;
  var options = {
    noTxList: parseInt(req.query.noTxList),
  };

  if (req.query.from && req.query.to) {
    options.from = parseInt(req.query.from);
    options.to = parseInt(req.query.to);
  }

  this.getAddressSummary(req.addr, options, function (err, data) {
    if (err) {
      return self.common.handleErrors(err, res);
    }
    var unspentTxids = data["unspentTxids"];
    var availableRewardsForAddr = 0;
    if (unspentTxids.length != 0) {
      var functionsArray = [];
      for (let i = 0; i < unspentTxids.length; i++) {
        functionsArray.push(function (callback1) {
          self.node.getDetailedTransaction(
            unspentTxids[i],
            function (err, transaction) {
              if (err && err.code === -5) {
                return self.common.handleErrors(null, res);
              } else if (err) {
                return self.common.handleErrors(err, res);
              }
              var vouts = transaction.outputs;
              var availableRewardsForTx = 0;
              for (let j = 0; j < vouts.length; j++) {
                var availableRewardForVout = 0;
                if (vouts[j].address != req.addr || vouts[j].spentTxId) {
                  availableRewardForVout = 0;
                } else {
                  var rewardData = {
                    tiptime:
                      self.node.services.bitcoind.tipTime || moment().unix(), //Using current time if tiptime is not available
                    locktime: transaction.locktime,
                    height: transaction.height,
                    satoshis: vouts[j].satoshis,
                  };
                  availableRewardForVout = getKomodoRewards(rewardData);
                }
                availableRewardsForTx =
                  availableRewardsForTx + availableRewardForVout;
              }
              callback1(null, availableRewardsForTx);
            }
          );
        });
      }
      async.parallel(functionsArray, function (err, resp) {
        for (let i = 0; i < resp.length; i++) {
          availableRewardsForAddr = availableRewardsForAddr + resp[i];
        }
        data.availableRewardsSat = availableRewardsForAddr;
        data.availableRewards = (availableRewardsForAddr * 1e-8).toFixed(4);

        res.jsonp(data);
      });
    } else {
      data.availableRewards = "Not able to Estimate rewards";
      data.availableRewardsSat = "Not able to Estimate rewards";
      res.jsonp(data);
    }
  });
};

AddressController.prototype.balance = function (req, res) {
  this.addressSummarySubQuery(req, res, "balanceSat");
};

AddressController.prototype.totalReceived = function (req, res) {
  this.addressSummarySubQuery(req, res, "totalReceivedSat");
};

AddressController.prototype.totalSent = function (req, res) {
  this.addressSummarySubQuery(req, res, "totalSentSat");
};

AddressController.prototype.unconfirmedBalance = function (req, res) {
  this.addressSummarySubQuery(req, res, "unconfirmedBalanceSat");
};

AddressController.prototype.availableRewards = function (req, res) {
  this.addressSummarySubQuery(req, res, "availableRewards");
};

AddressController.prototype.addressSummarySubQuery = function (
  req,
  res,
  param
) {
  var self = this;
  this.getAddressSummary(req.addr, {}, function (err, data) {
    if (err) {
      return self.common.handleErrors(err, res);
    }
    res.jsonp(data[param]);
  });
};

AddressController.prototype.getAddressSummary = function (
  address,
  options,
  callback
) {
  this.node.getAddressSummary(address, options, function (err, summary) {
    if (err) {
      return callback(err);
    }

    var transformed = {
      addrStr: address,
      balance: summary.balance / 1e8,
      balanceSat: summary.balance,
      totalReceived: summary.totalReceived / 1e8,
      totalReceivedSat: summary.totalReceived,
      totalSent: summary.totalSpent / 1e8,
      totalSentSat: summary.totalSpent,
      unconfirmedBalance: summary.unconfirmedBalance / 1e8,
      unconfirmedBalanceSat: summary.unconfirmedBalance,
      unconfirmedTxApperances: summary.unconfirmedAppearances, // misspelling - ew
      txApperances: summary.appearances, // yuck
      unspentTxids: summary.availableTxids,
    };

    callback(null, transformed);
  });
};

AddressController.prototype.checkAddr = function (req, res, next) {
  req.addr = req.params.addr;
  this.check(req, res, next, [req.addr]);
};

AddressController.prototype.checkAddrs = function (req, res, next) {
  if (req.body.addrs) {
    req.addrs = req.body.addrs.split(",");
  } else {
    req.addrs = req.params.addrs.split(",");
  }

  this.check(req, res, next, req.addrs);
};

AddressController.prototype.check = function (req, res, next, addresses) {
  var self = this;
  if (!addresses.length || !addresses[0]) {
    return self.common.handleErrors(
      {
        message: "Must include address",
        code: 1,
      },
      res
    );
  }

  for (var i = 0; i < addresses.length; i++) {
    try {
      var a = new bitcore.Address(addresses[i]);
    } catch (e) {
      return self.common.handleErrors(
        {
          message: "Invalid address: " + e.message,
          code: 1,
        },
        res
      );
    }
  }

  next();
};

AddressController.prototype.utxo = function (req, res) {
  var self = this;

  this.node.getAddressUnspentOutputs(req.addr, {}, function (err, utxos) {
    if (err) {
      return self.common.handleErrors(err, res);
    } else if (!utxos.length) {
      return res.jsonp([]);
    }
    res.jsonp(utxos.map(self.transformUtxo.bind(self)));
  });
};

AddressController.prototype.multiutxo = function (req, res) {
  var self = this;
  this.node.getAddressUnspentOutputs(req.addrs, true, function (err, utxos) {
    if (err && err.code === -5) {
      return res.jsonp([]);
    } else if (err) {
      return self.common.handleErrors(err, res);
    }

    res.jsonp(utxos.map(self.transformUtxo.bind(self)));
  });
};

AddressController.prototype.transformUtxo = function (utxoArg) {
  var utxo = {
    address: utxoArg.address,
    txid: utxoArg.txid,
    vout: utxoArg.outputIndex,
    scriptPubKey: utxoArg.script,
    amount: utxoArg.satoshis / 1e8,
    satoshis: utxoArg.satoshis,
  };
  if (utxoArg.height && utxoArg.height > 0) {
    utxo.height = utxoArg.height;
    utxo.confirmations =
      this.node.services.bitcoind.height - utxoArg.height + 1;
  } else {
    utxo.confirmations = 0;
  }
  if (utxoArg.timestamp) {
    utxo.ts = utxoArg.timestamp;
  }
  return utxo;
};

AddressController.prototype._getTransformOptions = function (req) {
  return {
    noAsm: parseInt(req.query.noAsm) ? true : false,
    noScriptSig: parseInt(req.query.noScriptSig) ? true : false,
    noSpent: parseInt(req.query.noSpent) ? true : false,
  };
};

AddressController.prototype.multitxs = function (req, res, next) {
  var self = this;

  var options = {
    from: parseInt(req.query.from) || parseInt(req.body.from) || 0,
  };

  options.to =
    parseInt(req.query.to) ||
    parseInt(req.body.to) ||
    parseInt(options.from) + 10;

  self.node.getAddressHistory(req.addrs, options, function (err, result) {
    if (err) {
      return self.common.handleErrors(err, res);
    }

    var transformOptions = self._getTransformOptions(req);

    self.transformAddressHistoryForMultiTxs(
      result.items,
      transformOptions,
      function (err, items) {
        if (err) {
          return self.common.handleErrors(err, res);
        }
        res.jsonp({
          totalItems: result.totalCount,
          from: options.from,
          to: Math.min(options.to, result.totalCount),
          items: items,
        });
      }
    );
  });
};

AddressController.prototype.transformAddressHistoryForMultiTxs = function (
  txinfos,
  options,
  callback
) {
  var self = this;

  var items = txinfos
    .map(function (txinfo) {
      return txinfo.tx;
    })
    .filter(function (value, index, self) {
      return self.indexOf(value) === index;
    });

  async.map(
    items,
    function (item, next) {
      self.txController.transformTransaction(item, options, next);
    },
    callback
  );
};

module.exports = AddressController;
