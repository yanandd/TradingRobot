// const WebSocket = require("rpc-websockets").Client;

// const channelName = "lightning_executions_FX_BTC_JPY";

// // note: rpc-websockets supports auto-reconection.
// const ws = new WebSocket("wss://ws.lightstream.bitflyer.com/json-rpc");

// ws.on("open", () => {
//     ws.call("subscribe", {
//         channel: channelName
//     });
// });

// ws.on("channelMessage", notify => {
//     console.log(notify.channel, notify.message);
// });

var express = require('express');
var app = express();

app.get('/', function (res, rep) {
    const WebSocket = require("rpc-websockets").Client;

    const channelName = "lightning_executions_FX_BTC_JPY";

    // note: rpc-websockets supports auto-reconection.
    const ws = new WebSocket("wss://ws.lightstream.bitflyer.com/json-rpc");

    ws.on("open", () => {
        ws.call("subscribe", {
            channel: channelName
        });
    });

    ws.on("channelMessage", notify => {
        console.log(notify.channel, notify.message);
    });
    console.log("robot running");
    rep.send('Hello, word!');
});

app.listen(3000);