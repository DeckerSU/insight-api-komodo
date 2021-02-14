var KOMODO_ENDOFERA = 7777777;
var LOCKTIME_THRESHOLD = 500000000;
var MIN_SATOSHIS = 1000000000;
var ONE_MONTH_CAP_HARDFORK = 1000000;
var ONE_HOUR = 60;
var ONE_MONTH = 31 * 24 * 60;
var ONE_YEAR = 365 * 24 * 60;
var DEVISOR = 10512000;

var getKomodoRewards = (utxo) => {
  // Validate types
  ["tiptime", "locktime", "height", "satoshis"].forEach((property) => {
    if (typeof utxo[property] !== "number") {
      throw new TypeError(`\`${property}\` option must be a number.`);
    }
  });

  // Destructure UTXO properties
  //var { tiptime, locktime, height, satoshis } = utxo;

  var tiptime = utxo.tiptime;
  var locktime = utxo.locktime;
  var height = utxo.height;
  var satoshis = utxo.satoshis;

  // Calculate coinage
  var coinage = Math.floor((tiptime - locktime) / ONE_HOUR);

  // Return early if UTXO is not eligible for rewards
  if (
    height >= KOMODO_ENDOFERA ||
    locktime < LOCKTIME_THRESHOLD ||
    satoshis < MIN_SATOSHIS ||
    coinage < ONE_HOUR ||
    !height
  ) {
    return 0;
  }

  // Cap reward periods
  var limit = height >= ONE_MONTH_CAP_HARDFORK ? ONE_MONTH : ONE_YEAR;
  var rewardPeriod = Math.min(coinage, limit);

  // The first hour of coinage should not accrue rewards
  rewardPeriod -= 59;

  // Calculate rewards
  var rewards = Math.floor(satoshis / DEVISOR) * rewardPeriod;

  // Ensure reward value is never negative
  if (rewards < 0) {
    throw new Error("Reward should never be negative");
  }

  return rewards;
};

module.exports = getKomodoRewards;
