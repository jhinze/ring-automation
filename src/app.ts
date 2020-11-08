import {RingDevice, Location, RingApi} from "ring-client-api";
const express = require('express');
const cron = require('node-cron');
const pino = require('pino');
const https = require('https');
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  prettyPrint: {
    colorize: false,
    translateTime: true
  }
})
const app = express();
const port = 8080;
const ringApi = new RingApi({
  refreshToken: String(process.env.REFRESH_TOKEN),
});
const lampCronExpression = process.env.LAMP_CRON || '*/5 * * * *';
const sixMinutes = 360000;
interface SunInfo {
  sunrise: Date | undefined,
  sunset: Date | undefined
}
let sunInfo: SunInfo = {
  sunrise: undefined,
  sunset: undefined
}
let lightWasTurnedOn = false;
let lampCronHeartbeat = Date.now();

app.get('/health', (req: any, res: { send: (arg0: string) => any; }) => {
  const lampCronHeartbeatAge = Date.now() - lampCronHeartbeat;
  if (lampCronHeartbeatAge > sixMinutes) {
    const errorMessage = `lampCronHeartbeat older than expected ${lampCronHeartbeatAge}`;
    logger.error(errorMessage);
    throw new Error(errorMessage);
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
  const switchName = 'Outlet Switch 1'
  const locations = await ringApi.getLocations();
  const location = locations[0];
  const devices = await location.getDevices();
  const outletSwitch1 = devices.find((device: RingDevice) => device.data.name === switchName);
  if (outletSwitch1) {
    if (await isArmed(location)) {
      if (await isAfterSunsetOrBeforeDawn(location)) {
        await setLight(outletSwitch1, true);
      } else {
        await setLight(outletSwitch1, false);
      }
    } else if (lightWasTurnedOn) {
      await setLight(outletSwitch1, false);
    }
  } else {
    logger.error(`Device with name ${switchName} not found`);
  }
}

async function isAfterSunsetOrBeforeDawn(location: Location): Promise<boolean> {
  const today = new Date(Date.now());
  if (!(sunInfo.sunrise && sunInfo.sunset && isSameDay(today, sunInfo.sunrise) && isSameDay(today, sunInfo.sunset))) {
    const response = await getSunriseSunset(location);
    sunInfo = {
      sunset: new Date(response.results.sunset),
      sunrise: new Date(response.results.sunrise)
    }
  } else {
    logger.info(`Already have sun info for ${today}`);
  }
  return isNowAfterSunsetOrBeforeDawn(sunInfo);
}

function isSameDay(first: Date, second: Date): boolean {
  const sameDay = first.getUTCFullYear() === second.getUTCFullYear() &&
                  first.getUTCMonth() === second.getUTCMonth() &&
                  first.getUTCDate() === second.getUTCDate();
  logger.info(`${first} and ${second} are ${sameDay ? '' : 'not '} the same day`);
  return sameDay;
}

function isNowAfterSunsetOrBeforeDawn(sunInfo: SunInfo): boolean {
  if (!(sunInfo.sunrise && sunInfo.sunset)) {
    throw Error("sunrise or sunset is undefined");
  }
  const now = new Date(Date.now());
  const beforeDawn = sunInfo.sunrise.valueOf() > now.valueOf();
  const afterSunset = sunInfo.sunset.valueOf() < now.valueOf();
  logger.info(`${now} is ${beforeDawn ? '' : 'not '}before dawn of today ${sunInfo.sunset}`)
  logger.info(`${now} is ${afterSunset ? '' : 'not '}after sunset of today ${sunInfo.sunrise}`)
  return beforeDawn || afterSunset;
}

function getSunriseSunset(location: Location): Promise<any> {
  logger.info(`Getting sunrise and sunset information for today (UTC) at ${location.locationDetails.name}`);
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
        logger.info(`Sunrise today (UTC) is ${response.results.sunrise}`)
        logger.info(`Sunset today (UTC) is ${response.results.sunset}`)
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

async function setLight(device: RingDevice, on: boolean) {
  lightWasTurnedOn = on;
  if (device.data.on !== on) {
    logger.info(`Turning ${device.name} ${on ? 'on' : 'off'}`)
    await device.setInfo({device: {v1: {on}}});
  } else {
    logger.info(`Device ${device.name} is already ${on ? 'on' : 'off'}`)
  }
}