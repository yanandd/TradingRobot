const { parentPort, MessagePort } = require('worker_threads');
const WebSocket = require("rpc-websockets").Client;
var port
const channelName = "lightning_ticker_FX_BTC_JPY";

parentPort.on('message', (data) => {
    port = data.port;
    port.postMessage('heres your message!');
   });

// note: rpc-websockets supports auto-reconection.
const ws = new WebSocket("wss://ws.lightstream.bitflyer.com/json-rpc");

ws.on("open", () => {
    ws.call("subscribe", {
        channel: channelName
    });
});

ws.on("channelMessage", notify => {
    port.postMessage({
        channel:notify.channel, 
        msg:notify.message});
});