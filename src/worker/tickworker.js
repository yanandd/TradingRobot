const { parentPort, MessagePort } = require('worker_threads');
const WebSocket = require("rpc-websockets").Client;
var port
const channelName = "lightning_ticker_FX_BTC_JPY";

parentPort.on('message', (data) => {
    port = data.port;
    if (data.mode == 'REALTIME') {
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
    }
    else if (data.mode == 'DEBUG'){        
        const fs = require("fs");
        const readline = require('readline');
        const path = require('path');
        
        var dir = path.join(__dirname, '../../data/20190716/') // your directory

        var files = fs.readdirSync(dir);//同步读取文件夹
        
        var tickfiles = files.filter((f)=>{
            return f.startsWith('record');
        });

        tickfiles.sort(function (a, b) {
            return fs.statSync(dir + a).mtime.getTime() -
                fs.statSync(dir + b).mtime.getTime();
        });

        tickfiles.forEach((file)=>{
            const read = fs.createReadStream(dir+file)
            read.setEncoding('utf-8')
            const rl = readline.createInterface({
                input: read
              });
            rl.on('line', (line) => {
                //console.log(line);
                port.postMessage({
                    channel: 'recordHistory',
                    message: line.trim()
                });
            });
            rl.on('close', (line) => {
            console.log("record读取完毕！");
            }); 

        })
        

    }

});

