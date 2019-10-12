const { Gpio } = require('pigpio');
const mqtt = require('mqtt');
const { safeLoad } = require('js-yaml');
const { readFile } = require('fs').promises;

(async () => {
    const configContent = await readFile('./config.yml');
    const config = safeLoad(configContent);

    const broker = mqtt.connect(config.mqtt.url);

    for (const name of Object.getOwnPropertyNames(config.lights)) {
        const light = config.lights[name];
        configureLight(name, light, broker);
    }

})();

function configureLight(name, light, broker) {
    const warmPin = new Gpio(temperatures.warm, { mode: Gpio.OUTPUT });
    const coldPin = new Gpio(temperatures.cold, { mode: Gpio.OUTPUT });
    const state = {
        brightness: 255,
        temperature: 153,
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
        writeState(state, warmPin, coldPin);
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
        state.temperature = payload.color_temp;
    }
}

function writeState(state, warm, cold) {
    if (!state.power) {
        warm.pwmWrite(0);
        cold.pwmWrite(0);
        return;
    }
    const warmValue = Math.round(calculateWarm(state.temperature) * 255);
    const coldValue = Math.round(calculateCold(state.temperature) * 255);
    warm.pwmWrite(warmValue);
    cold.pwmWrite(coldValue);
}

function calculateCold(x) {
    return -1 / 365 * x + 100 / 73;
}

function calculateWarm(x) {
    return 1 / 365 * x - 27 / 73;
}

function publishState(broker, stateTopic, state) {
    broker.publish(stateTopic, JSON.stringify({
        state: state.power ? 'ON' : 'OFF',
        brightness: state.brightness,
        color_temp: state.temperature
    }));
}
