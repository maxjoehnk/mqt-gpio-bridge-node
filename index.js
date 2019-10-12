const Gpio = require('./gpio');
const mqtt = require('mqtt');
const { safeLoad } = require('js-yaml');
const { readFile } = require('fs').promises;

const FADE_TIMEOUT = 1;

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
    const warmPin = new Gpio(light.temperatures.warm, { mode: Gpio.OUTPUT });
    const coldPin = new Gpio(light.temperatures.cold, { mode: Gpio.OUTPUT });
    const state = {
        brightness: 255,
        temperature: 153,
        power: true,
        values: new WeakMap()
    };
    state.values.set(warmPin, 0);
    state.values.set(coldPin, 0);
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
        fade(state, {
            pin: warm,
            value: 0
        }, {
            pin: cold,
            value: 0
        });
        return;
    }
    const warmValue = Math.round(calculateWarm(state.temperature) * 255);
    const coldValue = Math.round(calculateCold(state.temperature) * 255);
    fade(state, {
        pin: warm,
        value: warmValue
    }, {
        pin: cold,
        value: coldValue
    });
}

function fade(state, warm, cold) {
    clearInterval(state.interval);

    function write(pin, value) {
        state.values.set(pin, value);
        pin.pwmWrite(value);
    }

    state.interval = setInterval(() => {
        let currentWarm = state.values.get(warm.pin);
        let currentCold = state.values.get(cold.pin);

        if (currentWarm > warm.value) {
            currentWarm--;
        } else if (currentWarm < warm.value) {
            currentWarm++;
        }
        if (currentCold > cold.value) {
            currentCold--;
        } else if (currentCold < cold.value) {
            currentCold++;
        }
        write(cold.pin, currentCold);
        write(warm.pin, currentWarm);
        if (currentCold === cold.value && currentWarm === warm.value) {
            clearInterval(state.interval);
        }
    }, FADE_TIMEOUT);
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
