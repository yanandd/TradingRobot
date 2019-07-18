const MainServer = require('./src/MainServer')
const httpApi = require('./src/httpAPI')
var express = require('express');
var app = express();
var server = new MainServer();
var loop = async function(){
    //console.log(server.getTick)
    //console.log(server.getPrices)
    // var a =server.test()
    // console.log(a)
    // console.log(a.length)
    var exchangeStatue = JSON.parse(await httpApi.getHealth().then((result)=>{return result}))
    console.log(exchangeStatue,'@start.js')
    if(exchangeStatue && 'STOP' != exchangeStatue.status && server.getRecords.length > 0){
        server.writeRecord('record')
        server.writeRecord('executions')
        await server.startTrade()
        console.log('1回合结束')
    }
    setTimeout(loop,10000)
}
setTimeout(loop,200)
app.get('/', function (res, rep) {
    rep.send('Hello, word!');
});

app.listen(3000);