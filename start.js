const MainServer = require('./src/MainServer')
const httpApi = require('./src/httpAPI')
var express = require('express');
var app = express();
var server = new MainServer();
var Sleep = async function (ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

//   httpApi.getPosition().then((res)=>{
    
//     console.log(res,222)
// })

//   server.sendOrder('SELL','0.01',1190000).then((result)=>{
//     console.log(result,1111)
    // Sleep(10000)
    // httpApi.cancelOrder(result).then((res)=>{
    //         console.log(res,222)
    //     })
// })

var loop = async function(){
    //await server.startTrade()
    
    var exchangeStatue = JSON.parse(await httpApi.getHealth())
    console.log(exchangeStatue,'@start.js')
    if(exchangeStatue && 'STOP' != exchangeStatue.status && server.getRecords.length > 0){
        await server.startTrade()
        //server.test()
        console.log('1回合结束')
    }
    //setTimeout(loop,10000)
}


setTimeout(loop,200)
app.get('/', function (res, rep) {
    rep.send('Hello, word!');
});

app.listen(3000);