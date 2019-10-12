try {
    const { Gpio } = require('pigpio');
    module.exports = Gpio;
} catch (err) {
    console.error('pigpio not available, using stub');

    class Gpio {
        constructor(pin) {
            this.pin = pin;
        }

        pwmWrite(value) {
            console.log(`writing ${this.pin} = ${value}`);
        }
    }

    Gpio.OUTPUT = 'output';

    module.exports = Gpio;
}