const { Worker,MessageChannel } = require('worker_threads');
const tickPorts = new MessageChannel();
const executionsPorts = new MessageChannel();

const worker1 = new Worker('./src/tickworker.js')
const worker2 = new Worker('./src/executionsworker.js')

tickPorts.port1.on('message', (message) => {
    console.log('message from worker:', message.channel);
   });

executionsPorts.port1.on('message', (message) => {
    console.log('message from worker:', message.channel);
   });

worker1.postMessage({ port: tickPorts.port2 }, [tickPorts.port2]);
worker2.postMessage({ port: executionsPorts.port2 }, [executionsPorts.port2]);

var express = require('express');
var app = express();
//const buffer = new SharedArrayBuffer(1 * Int32Array.BYTES_PER_ELEMENT);
//const myList = new Int32Array(buffer);

app.get('/', function (res, rep) {
    rep.send('Hello, word!');
});

app.listen(3000);