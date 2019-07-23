const { parentPort, MessagePort } = require('worker_threads');
const WebSocket = require("rpc-websockets").Client;
var port
const channelName = "lightning_executions_BTC_JPY";
const RUN_MODE = {
    DEBUG: 'debug',
    REALTIME: 'realtime'
  }
parentPort.on('message', (data) => {
    port = data.port;
    if (data.mode == RUN_MODE.REALTIME) {
        // note: rpc-websockets supports auto-reconection.
        var ws = new WebSocket("wss://ws.lightstream.bitflyer.com/json-rpc");

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
});

