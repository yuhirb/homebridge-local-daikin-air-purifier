module.exports = class DaikinAirPurifier {

  /**
   * REQUIRED - This is the entry point to your plugin
   */
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.refreshInterval = this.config.refreshInterval || 10000;
    this.timer = setTimeout(this.poll.bind(this), this.refreshInterval);

    this.log.debug('Daikin Air Purifier Accessory Plugin Loaded');
    this.log.debug('config:', config);
  }

  /**
   * REQUIRED - This must return an array of the services you want to expose.
   * This method must be named "getServices".
   */
  getServices() {
    const { Service, Characteristic } = this.api.hap;
    const informationService = new Service.AccessoryInformation();
    informationService.setCharacteristic(Characteristic.Manufacturer, 'DAIKIN INDUSTRIES, LTD.,');
    informationService.setCharacteristic(Characteristic.Model, this.config.model || '-');
    informationService.setCharacteristic(Characteristic.Name, this.config.name || '-');
    informationService.setCharacteristic(Characteristic.SerialNumber, this.config.serialNumber || '-');
    informationService.getCharacteristic(Characteristic.FirmwareRevision)
      .onGet(this.getFirmwareRevisionHandler.bind(this));

    const airPurifierService = new Service.AirPurifier(this.name);
    airPurifierService.getCharacteristic(Characteristic.Active)
      .onGet(this.getActiveHandler.bind(this))
      .onSet(this.setActiveHandler.bind(this));
    airPurifierService.getCharacteristic(Characteristic.CurrentAirPurifierState)
      .onGet(this.getCurrentAirPurifierStateHandler.bind(this));
    airPurifierService.getCharacteristic(Characteristic.TargetAirPurifierState)
      .onGet(this.getTargetAirPurifierStateHandler.bind(this))
      .onSet(this.setTargetAirPurifierStateHandler.bind(this));

    this.informationService = informationService;
    this.airPurifierService = airPurifierService;
    return [informationService, airPurifierService];
  }

  async getFirmwareRevisionHandler() {
    this.log.info('Getting Firmware Revision');
    try {
      const { ver } = await this.getBasicInfo();
      return ver.replace(/_/g, '.');
    } catch (error) {
      this.log.error('error', error);
      return '';
    }
  }

  async getActiveHandler() {
    this.log.info('Getting active state');
    const { Characteristic } = this.api.hap;
    const { ctrl_info } = await this.getUnitInfo();
    return ctrl_info && ctrl_info.pow && Number(ctrl_info.pow) === 1
      ? Characteristic.Active.ACTIVE
      : Characteristic.Active.INACTIVE;
  }

  async setActiveHandler(value) {
    this.log.info('[change] Setting active state to:', value);
    const { Characteristic } = this.api.hap;
    const result = await this.setControlInfo({
      pow: value === Characteristic.Active.ACTIVE ? 1 : 0,
    });
    if (result) {
      this.airPurifierService.getCharacteristic(Characteristic.CurrentAirPurifierState)
        .updateValue(value === Characteristic.Active.ACTIVE
          ? Characteristic.CurrentAirPurifierState.PURIFYING_AIR
          : Characteristic.CurrentAirPurifierState.INACTIVE);
      this.log.info('[change] Updated active state to:', value);
    } else {
      this.log.info('[change] Failed to update active state');
    }
  }

  async getCurrentAirPurifierStateHandler() {
    this.log.info('Getting current air purifier state');
    const { Characteristic } = this.api.hap;
    const { ctrl_info } = await this.getUnitInfo();
    return ctrl_info && ctrl_info.pow && Number(ctrl_info.pow) === 1
      ? Characteristic.CurrentAirPurifierState.PURIFYING_AIR
      : Characteristic.CurrentAirPurifierState.INACTIVE;
  }

  async getTargetAirPurifierStateHandler() {
    this.log.info('Getting target air purifier state');
    const { Characteristic } = this.api.hap;
    const { ctrl_info } = await this.getUnitInfo();
    const isActive = ctrl_info && ctrl_info.pow && Number(ctrl_info.pow) === 1;
    if (!isActive) {
      return Characteristic.CurrentAirPurifierState.INACTIVE;
    }
    const { mode } = ctrl_info || {};
    return Number(mode) === 1 // おまかせ
      ? Characteristic.TargetAirPurifierState.AUTO
      : Characteristic.TargetAirPurifierState.MANUAL;
  }

  async setTargetAirPurifierStateHandler(value) {
    this.log.info('[change] Setting target air purifier state to:', value);
    const { Characteristic } = this.api.hap;
    const { ctrl_info } = await this.getUnitInfo();
    const isAuto = value === Characteristic.TargetAirPurifierState.AUTO;
    const result = await this.setControlInfo({
      ...ctrl_info,
      mode: isAuto ? 1 : 0, // 1:おまかせ 0:風量自動
      airvol: 0,
    });
    if (result) {
      this.log.info('[change] Updated target air purifier state to:', value);
    } else {
      this.log.info('[change] Failed to update target air purifier state');
    }
  }

  async poll() {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = null;

    const { ctrl_info } = await this.getUnitInfo();
    const { pow, mode } = ctrl_info;
    const { Characteristic } = this.api.hap;
    this.airPurifierService.getCharacteristic(Characteristic.Active)
      .updateValue(Number(pow) === 1
        ? Characteristic.Active.ACTIVE
        : Characteristic.Active.INACTIVE);
    this.airPurifierService.getCharacteristic(Characteristic.CurrentAirPurifierState)
      .updateValue(Number(pow) === 1
        ? Characteristic.CurrentAirPurifierState.PURIFYING_AIR
        : Characteristic.CurrentAirPurifierState.INACTIVE);
    this.airPurifierService.getCharacteristic(Characteristic.TargetAirPurifierState)
      .updateValue(Number(mode) === 1
        ? Characteristic.TargetAirPurifierState.AUTO
        : Characteristic.TargetAirPurifierState.MANUAL);

    this.timer = setTimeout(this.poll.bind(this), this.refreshInterval);
  }

  async getBasicInfo() {
    const timestamp = +new Date();
    // Use cache for 5 minutes.
    const { basicInfoCache } = this;
    if (basicInfoCache && basicInfoCache.time > timestamp - 300000) {
      this.log.debug('/common/basic_info cache:', basicInfoCache.body);
      return basicInfoCache.body;
    }
    const body = await this.sendGetRequest('/common/basic_info');
    this.log.debug('/common/basic_info', body);
    this.basicInfoCache = {
      body,
      time: +new Date(),
    };
    return body;
  }

  async getUnitInfo() {
    const timestamp = +new Date();
    const { unitInfoCache } = this;
    if (unitInfoCache && unitInfoCache.time > timestamp - this.refreshInterval) {
      this.log.debug('/cleaner/get_unit_info cache:', unitInfoCache.body);
      return unitInfoCache.body;
    }
    const responseBody = await this.sendGetRequest('/cleaner/get_unit_info');
    const body = {
      ...responseBody,
      ctrl_info: this.convertResponseBody(decodeURIComponent(responseBody.ctrl_info)),
      sensor_info: this.convertResponseBody(decodeURIComponent(responseBody.sensor_info)),
      unit_status: this.convertResponseBody(decodeURIComponent(responseBody.unit_status)),
      dev_setting: this.convertResponseBody(decodeURIComponent(responseBody.dev_setting)),
    };
    this.log.debug('/cleaner/get_unit_info', body);
    this.unitInfoCache = {
      body,
      time: +new Date(),
    };
    return body;
  }

  async setControlInfo(options) {
    const query = Object.keys(options).map((key) => `${key}=${options[key]}`).join('&');
    const body = await this.sendGetRequest(`/cleaner/set_control_info?${query}`);
    this.log.debug('/cleaner/set_control_info', body);
    const result = body.ret === 'OK';
    if (result) {
      this.unitInfoCache = null;
    }
    return result;
  }

  sendGetRequest(path) {
    const http = require('http');
    const { ip } = this.config;
    const options = {
      method: 'GET',
      host: ip,
      path,
    };
    return new Promise((resolve, reject) => {
      const request = http.request(options, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          const bodyObject = this.convertResponseBody(body);
          resolve(bodyObject);
        });
      });
      request.on('error', (error) => {
        this.log.error('request error', path, error);
        reject(error);
      });
      request.end();
    });
  }

  convertResponseBody(body) {
    return body.split(',').reduce((object, keyValueString) => {
      const keyValueArray = keyValueString.split('=');
      if (keyValueArray.length !== 2) {
        return object;
      }
      return {
        ...object,
        [keyValueArray[0]]: keyValueArray[1],
      };
    }, {});
  }
};
