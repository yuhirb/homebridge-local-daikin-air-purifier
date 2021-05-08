const DaikinAirPurifier = require('./DaikinAirPurifier');

module.exports = function(homebridge) {
    homebridge.registerAccessory('homebridge-daikin-air-purifier', 'DaikinAirPurifier', DaikinAirPurifier);
};
