const { parentPort, MessagePort } = require('worker_threads');
const WebSocket = require("rpc-websockets").Client;
var port
var ws
const channelName = "lightning_executions_FX_BTC_JPY";
const RUN_MODE = {
    DEBUG: 'debug',
    REALTIME: 'realtime'
  }
parentPort.on('message', (data) => {
    port = data.port;
    if (data.mode == RUN_MODE.REALTIME) {
        // note: rpc-websockets supports auto-reconection.
        if (data.type == 'init') {
            ws = new WebSocket("wss://ws.lightstream.bitflyer.com/json-rpc");

            ws.on("open", () => {
                ws.call("subscribe", {
                    channel: channelName
                });
            });

            ws.on("channelMessage", notify => {
                port.postMessage({
                    channel: notify.channel,
                    message: notify.message
                });
            });
        }
        if (data.type == 'reset'){
            ws.close();
            ws = new WebSocket("wss://ws.lightstream.bitflyer.com/json-rpc");

            ws.on("open", () => {
                ws.call("subscribe", {
                    channel: channelName
                });
            });

            ws.on("channelMessage", notify => {
                port.postMessage({
                    channel: notify.channel,
                    message: notify.message
                });
            });
        }
    } 
});

