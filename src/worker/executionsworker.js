const { parentPort, MessagePort } = require('worker_threads');
const WebSocket = require("rpc-websockets").Client;
var port
const channelName = "lightning_executions_FX_BTC_JPY";

parentPort.on('message', (data) => {
    port = data.port;
    if (data.mode == 'REALTIME') {
        // note: rpc-websockets supports auto-reconection.
        const ws = new WebSocket("wss://ws.lightstream.bitflyer.com/json-rpc");

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
    } else {
        return
        const fs = require("fs");
        const readline = require('readline');
        const path = require('path');

        var dir = path.join(__dirname, '../../data/20190716/') // your directory

        var files = fs.readdirSync(dir);//同步读取文件夹
        var execfiles = files.filter((f) => {
            return f.startsWith('exec');
        });

        execfiles.sort(function (a, b) {
            return fs.statSync(dir + a).mtime.getTime() -
                fs.statSync(dir + b).mtime.getTime();
        });

        execfiles.forEach((file) => {
            const read = fs.createReadStream(dir + file)
            read.setEncoding('utf-8')
            const rl = readline.createInterface({
                input: read
            });
            rl.on('line', (line) => {
                port.postMessage({
                    channel: 'executionHistory',
                    message: line.trim()
                });
            });
            rl.on('close', (line) => {
                console.log("读取完毕！");
            });
           
        })


    }
});

