const { Gpio } = require('pigpio');
const mqtt = require('mqtt');
const {safeLoad} = require('js-yaml');
const {readFile} = require('fs').promises;

(async () => {
    const configContent = await readFile('./config.yml');
    const config = safeLoad(configContent);

    const broker = mqtt.connect(config.mqtt.url);

    for (const name of Object.getOwnPropertyNames(config.lights)) {
        const light = config.lights[name];
        configureLight(name, light, broker);
    }

})();

function publishState(broker, stateTopic, state) {
    broker.publish(stateTopic, JSON.stringify({
        state: state.power ? 'ON' : 'OFF',
        brightness: state.brightness,
        color_temp: kelvinToMired(state.temperature)
    }));
}

function configureLight(name, light, broker) {
    const temperatures = [...light.temperatures];
    temperatures.sort((a, b) => a.color - b.color);
    const warm = temperatures[0];
    const cold = temperatures[1];
    const warmPin = new Gpio(warm.pin, {mode: Gpio.OUTPUT});
    const coldPin = new Gpio(cold.pin, {mode: Gpio.OUTPUT});
    const state = {
        brightness: 255,
        temperature: warm.color,
        power: true
    };
    const lightTopic = `lights/${name}/set`;
    const stateTopic = `lights/${name}`;
    broker.on('message', (topic, message) => {
        if (topic !== lightTopic) {
            return;
        }
        const payload = JSON.parse(message.toString());
        console.log(topic, payload);
        applyPower(payload, state);
        applyBrightness(payload, state);
        applyTemperature(payload, state);
        writeState(state, {pin: warmPin, color: warm.color}, {pin: coldPin, color: cold.color});
        publishState(broker, stateTopic, state);
    });
    broker.subscribe(lightTopic, (err) => {
        if (err) {
            console.error(err);
        }
    });
}

function applyPower(payload, state) {
    if (payload.state === 'OFF') {
        state.power = false;
    } else if (payload.state === 'ON') {
        state.power = true;
    }
}

function applyBrightness(payload, state) {
    if ('brightness' in payload) {
        state.brightness = payload.brightness;
    }
}

function applyTemperature(payload, state) {
    if ('color_temp' in payload) {
        state.temperature = miredToKelvin(payload.color_temp);
    }
}

function miredToKelvin(mired) {
    return Math.round(1000000 / mired);
}

function kelvinToMired(kelvin) {
    return Math.round(1000000 / kelvin);
}

function writeState(state, warm, cold) {
    if (!state.power) {
        warm.pin.pwmWrite(0);
        cold.pin.pwmWrite(0);
        return;
    }
    const temperature = Math.min(Math.max(state.temperature, warm.color), cold.color);
    const warmValue = Math.round(calculateWarm(temperature) * 255);
    const coldValue = Math.round(calculateCold(temperature) * 255);
    warm.pin.pwmWrite(warmValue);
    cold.pin.pwmWrite(coldValue);
}

// for cold = 7000 and warm = 2800
function calculateCold(target) {
    return 1 / 4200 * target - 2 / 3
}

// for cold = 7000 and warm = 2800
function calculateWarm(target) {
    return -1 / 4200 * target + 5 / 3;
}