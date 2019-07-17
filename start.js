const MainServer = require('./src/MainServer')
var express = require('express');
var app = express();
var server = new MainServer();

var loop = async function(){
    //console.log(server.getTick)
    //console.log(server.getPrices)
    console.log(server.test(),111)
    if(server.getRecords.length > 0){
        server.writeRecord('record')
        server.writeRecord('executions')
        await server.trader()
        console.log('1回合结束')
    }
    setTimeout(loop,1000)
}
setTimeout(loop,200)
app.get('/', function (res, rep) {
    rep.send('Hello, word!');
});

app.listen(3000);