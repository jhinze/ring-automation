import {RingDevice, Location, RingApi} from "ring-client-api";
import {RingCamera} from "ring-client-api/lib/api/ring-camera";
const express = require('express');
const cron = require('node-cron');
const pino = require('pino');
const expressPino = require('express-pino-logger');
const https = require('https');
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  prettyPrint: {
    colorize: false,
    translateTime: true
  }
})
const expressLogger = expressPino({ logger });
const app = express();
const port = 8080;
const ringApi = new RingApi({
  refreshToken: String(process.env.REFRESH_TOKEN),
});
const lampCronExpression = process.env.LAMP_CRON || '*/5 * * * *';
const sixMinutes = 360000;
let lightWasTurnedOn = false;
let lampCronHeartbeat = Date.now();

app.use(expressLogger);

app.get('/health', (req: any, res: { send: (arg0: string) => any; }) => {
  const lampCronHeartbeatAge = Date.now() - lampCronHeartbeat;
  if (Date.now() - lampCronHeartbeat > sixMinutes) {
    throw new Error(`lampCronHeartbeat older than expected ${lampCronHeartbeatAge}`)
  } else {
    res.send('Okay')
  }
});

app.listen(port, () => {
  logger.info(`Server is listening on port ${port}`);
});

cron.schedule(lampCronExpression, () => {
  turnOnLampIfArmedAndDark().then(() => lampCronHeartbeat = Date.now());
});

async function turnOnLampIfArmedAndDark(): Promise<void> {
  const locations = await ringApi.getLocations();
  const location = locations[0];
  const doorbellCamera = location.cameras.find((camera: RingCamera) => camera.data.description === 'Front Door');
  const devices = await location.getDevices();
  const outletSwitch1 = devices.find((device: RingDevice) => device.data.name === 'Outlet Switch 1');
  if (outletSwitch1) {
    if (await isArmed(location)) {
      if (doorbellCamera && (isDarkOutside(doorbellCamera) || await isAfterSunsetOrBeforeDawn(location))) {
        await setLight(outletSwitch1, true);
      } else {
        await setLight(outletSwitch1, false);
      }
    } else if (lightWasTurnedOn) {
      await setLight(outletSwitch1, false);
    }
  }
}

async function isAfterSunsetOrBeforeDawn(location: Location): Promise<boolean> {
  const response = await getSunriseSunset(location);
  const sunset = Date.parse(response.results.sunset);
  const sunrise = Date.parse(response.results.sunrise);
  const now = Date.now();
  const isAfterSunsetOrBeforeDawn = sunset < now || sunrise > now;
  logger.info(`It is ${isAfterSunsetOrBeforeDawn ? '' : 'not'} after sunset or before dawn`)
  return isAfterSunsetOrBeforeDawn;
}

function getSunriseSunset(location: Location): Promise<any> {
  const latitude = location.locationDetails.geo_coordinates.latitude;
  const longitude = location.locationDetails.geo_coordinates.longitude;
  const url = `https://api.sunrise-sunset.org/json?lat=${latitude}&lng=${longitude}&date=today&formatted=0`;
  return new Promise((resolve, reject) => {
    https.get(url, (response: { on: (arg0: string, arg1: (chunk: string) => void) => void; }) => {
      let data = '';
      response.on('data', (chunk:string) => {
        data += chunk;
      });
      response.on('end', () => {
        const response = JSON.parse(data);
        resolve(response);
      });
      response.on('error', (error: string) => {
        logger.error(`Error getting sunrise-sunset: ${error}`);
        reject(error);
      });
    });
  });
}

async function isArmed(location: Location): Promise<boolean> {
  const mode = await location.getLocationMode();
  logger.info(`Location mode is ${mode.mode}`);
  return mode.mode === 'away';
}

function isDarkOutside(camera: RingCamera): boolean {
  const isDark = camera.data.night_mode_status === 'true';
  logger.info(`It appears ${isDark ? '' : 'not'} to be dark outside`);
  return isDark;
}

async function setLight(device: RingDevice, on: boolean) {
  lightWasTurnedOn = on;
  if (device.data.on !== on) {
    logger.info(`Turning ${device.name} ${on ? 'on' : 'off'}`)
    await device.setInfo({device: {v1: {on}}});
  } else {
    logger.info(`Device ${device.name} is already ${on ? 'on' : 'off'}`)
  }
}