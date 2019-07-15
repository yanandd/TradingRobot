const { Worker, MessageChannel } = require('worker_threads');
let WS = require('./worker/WriteStream')
const httpApi = require('./httpAPI')
const Burst_Threshold_Value = 1000000 //价格突破时成交金额考量阈值 小于此阈值意味着价格突破时成交金额过小，成功率会较低 初始值为1万美元
const Min_Stock = 0.01  //最小交易金额 原始预设为0.01
const Burst_Threshold_Pct = 0.00005 //价格突破比 原始预设为0.00005
const Price_Check_Length = 5 //比较价格是参考的历史价格数据长度 预设为6

Date.prototype.Format = function (fmt) {
  var o = {
    "y+": this.getFullYear(),
    "M+": this.getMonth() + 1,                 //月份
    "d+": this.getDate(),                    //日
    "h+": this.getHours(),                   //小时
    "m+": this.getMinutes(),                 //分
    "s+": this.getSeconds(),                 //秒
    "q+": Math.floor((this.getMonth() + 3) / 3), //季度
    "S+": this.getMilliseconds()             //毫秒
  };
  for (var k in o) {
    if (new RegExp("(" + k + ")").test(fmt)){
      if(k == "y+"){
        fmt = fmt.replace(RegExp.$1, ("" + o[k]).substr(4 - RegExp.$1.length));
      }
      else if(k=="S+"){
        var lens = RegExp.$1.length;
        lens = lens==1?3:lens;
        fmt = fmt.replace(RegExp.$1, ("00" + o[k]).substr(("" + o[k]).length - 1,lens));
      }
      else{
        fmt = fmt.replace(RegExp.$1, (RegExp.$1.length == 1) ? (o[k]) : (("00" + o[k]).substr(("" + o[k]).length)));
      }
    }
  }
  return fmt;
}

var max = function (param) {
  if (param instanceof Array) {
    return Math.max(...param)
  } else {
    throw 'max function Error!'
  }
}
var min = function (param) {
  if (param instanceof Array) {
    return Math.min(...param)
  } else {
    throw 'min function Error!'
  }
}

var Sleep = async function (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

class MainServer {
  constructor() {
    this.isRunning = true;
    this.tickPort = new MessageChannel();
    this.executionsPort = new MessageChannel();

    this.tickworker = new Worker('./src/worker/tickworker.js')
    this.execworker = new Worker('./src/worker/executionsworker.js')

    this.K = []
    this.prices = [...Array(100)].map(_ => 0); // 历史成交价格
    this.vol = [] //历史成交量
    this.tickPrice //本轮tick价格
    this.tickInMinus = []
    this.tickVolMinus = 0
    this.VolPriceMinusSell = 0
    this.VolPriceMinusBuy = 0
    this.VolPriceBuy = []
    this.VolPriceSell = []
    this.orderBook
    this.bidPrice
    this.askPrice
    this.lastPrice
    this.JPY = 100000;
    this.btc = 0
    this.tickTime = ''
    this.K_WriteBuff = []
    this.exec_WriteBuff = []
    this.tickPort.port1.on('message', (message) => {
      //console.log('message from worker:', message.channel);
      this.tick = eval(message.message)
      //console.log('TICK--------------')
      if (this.tick === undefined)
        return
      this.lastPrice = this.tick.ltp
      this.bidPrice = this.tick.best_bid + 1
      this.askPrice = this.tick.best_ask - 1
      this.tickPrice = Math.round((this.bidPrice + this.askPrice) / 2)

      //console.log(this.lastPrice,this.prices[this.prices.length-1])
    });


    this.executionsPort.port1.on('message', (message) => {
      this.executions = eval(message.message)
      if (this.executions instanceof Array) {
        this.executions.forEach(el => {
          this.prices.shift()
          this.prices.push(el.price)
          el.Time = el.exec_date;
          this.exec_WriteBuff.push(el)
          //var tickDate = el.exec_date.slice(0,10)
          var currentTime = el.exec_date.slice(11, 16);
          if (this.tickTime != currentTime) {
            //console.log(this.tickTime,currentTime)
            this.tickTime = currentTime;
            if (this.tickInMinus.length != 0) {
              var k = {
                Time: new Date(el.exec_date) - 1000,
                Open: this.tickInMinus[0],
                High: max(this.tickInMinus),
                Low: min(this.tickInMinus),
                Close: this.tickInMinus[this.tickInMinus.length - 1],
                Volume: this.tickVolMinus
              }
              this.K_WriteBuff.push(k)
              this.K.push(k);
              this.tickInMinus = []
              this.tickVolMinus = 0
              this.VolPriceBuy.push(this.VolPriceMinusBuy)
              if (this.VolPriceBuy.length > 200) {
                this.VolPriceBuy.shift()
              }
              this.VolPriceMinusBuy = 0
              this.VolPriceSell.push(this.VolPriceMinusSell)
              if (this.VolPriceSell.length > 200) {
                this.VolPriceSell.shift()
              }
              this.VolPriceMinusSell = 0
              // this.VolPrice.forEach((el)=>{
              //   console.log(el)  
              // })
              // this.K.forEach((el)=>{
              //   console.log(el)  
              // })

            }
          } else {
            this.tickVolMinus += el.size
            this.tickInMinus.push(el.price)
            if (el.side == 'BUY')
              this.VolPriceMinusBuy += parseFloat(el.size) * parseFloat(el.price)
            else
              this.VolPriceMinusSell += parseFloat(el.size) * parseFloat(el.price)
            //console.log(this.VolPriceMinus)
          }
          //exec_date:2019-07-14T15:10:41.18609Z
        });
      }
    });

    this.tickworker.postMessage({ port: this.tickPort.port2 }, [this.tickPort.port2]);
    this.execworker.postMessage({ port: this.executionsPort.port2 }, [this.executionsPort.port2]);
    
    //setTimeout(this.getPosition,200)
    //httpApi.getPosition()
    //httpApi.getCollateral()
  }

  get getTick() {
    return this.tick;
  }
  get getPrices() {
    return this.prices;
  }
  get getRecords() {
    return this.K;
  }
  test() {
    return max([1, 2])
  }

  async trader() {
    console.log('交易开始')

    var numTick = 0
    var checkLen = Price_Check_Length
    var bull //做多
    var bear //做空
    var tradeTime = 0
    var tradeAmount //交易数量
    var nowProfit = 0
    var preProfit = 0
    var burstPrice
    var trading = false
    while (tradeTime < 1000) {
      if (this.K.length < 5) {
        await Sleep(1000)
        continue
      }
      if (trading) {
        await Sleep(200)
        continue
      }
      numTick++
      nowProfit = Math.round(this.btc * this.tickPrice + this.JPY)
      if (Math.abs(nowProfit - preProfit) > burstPrice * 3) {
        console.log('BTC ', this.btc, ' JPY', this.JPY, ' Profit ', Math.round(this.btc * this.tickPrice + this.JPY))
        preProfit = nowProfit
      }
      bull = false
      bear = false
      var LastVP_Buy = this.VolPriceMinusBuy;
      var LastVP_Sell = this.VolPriceMinusSell;
      var HVP_Buy = max(this.VolPriceBuy.slice(this.VolPriceBuy.length - checkLen))//上一轮tick的历史最高量价
      var HVP_Sell = max(this.VolPriceSell.slice(this.VolPriceSell.length - checkLen))//上一轮tick的历史最高量价
      // var LHP2 = max(this.VolPrice.slice(this.VolPrice.length - checkLen - 1, -1)) //上上一轮tick的历史最高量价
      // var LLP = min(this.VolPrice.slice(this.VolPrice.length - checkLen))//上一轮tick的历史最低量价
      // var LLP2 = min(this.VolPrice.slice(this.VolPrice.length - checkLen - 1, -1))//上上一轮tick的历史最低量价
      //burstPrice = HVP_Buy - HVP_Sell // * Burst_Threshold_Pct // 突破价格点差
      var powerDiff = HVP_Buy - HVP_Sell
      var diffRate = 0.35
      console.log('买方力量 减 卖方力量: ', 'HVP_Buy-HVP_Sell=', powerDiff, 'rate:', ((HVP_Buy - HVP_Sell) / HVP_Sell * 100).toFixed(2))
      var balance = async function () {
        if (trading) {
          await Sleep(200)
        }
      }

      if (HVP_Sell == 0 || HVP_Buy == 0) {
        await Sleep(3000)
        continue
      }
      //力量策略，如果买方卖方力量差距超过阈值，则开始交易
      if (powerDiff > 0 && powerDiff > HVP_Sell * diffRate && LastVP_Sell != 0 && (LastVP_Buy - LastVP_Sell) / LastVP_Sell > diffRate) {
        console.log('力量向上突破', powerDiff,(new Date()).Format('yyyy-MM-dd hh:mm:ss'))
        bull = true
        tradeAmount = this.JPY / this.bidPrice //* 0.9
      } else if (powerDiff < 0 && Math.abs(powerDiff) > HVP_Buy * diffRate && LastVP_Buy != 0 && Math.abs(LastVP_Buy - LastVP_Sell) / LastVP_Buy > diffRate) {
        console.log('力量向下突破', powerDiff, (new Date()).Format('yyyy-MM-dd hh:mm:ss'))
        bear = true
        tradeAmount = this.btc
      }
      // 趋势策略，价格出现方向上的突破时开始交易
      // 最新成交价比之上一个tick的历史高点产生突破，或者比之上上个tick的历史最高价产生突破，且比上一个tick的成交价更高
      // if (LTP - LHP > burstPrice || LTP - LHP2 > burstPrice && LTP > this.prices[this.prices.length-2]) {
      //   console.log('价格向上突破',burstPrice)
      //   bull = true
      //   tradeAmount = this.JPY / this.bidPrice //* 0.99
      // }// 反之，向下突破时开始交易
      // if (LTP - LLP < -burstPrice || LTP - LLP2 < -burstPrice && LTP < this.prices[this.prices.length-2]) {
      //   console.log('价格向下突破',burstPrice)
      //   bear = true
      //   tradeAmount = this.btc
      // }

      if ((!bull && !bear) || tradeAmount < Min_Stock) {
        //console.log(numTick)
        await Sleep(60000)
        continue
      }
      var now = new Date();
      trading = true
      if (bull) {
        console.log('Tick:', numTick, ' Buy:', tradeAmount, ' Price:', this.tickPrice, ' Profit:', Math.round(this.btc * this.tickPrice + this.JPY), now.toLocaleString())
        this.btc = this.btc + tradeAmount
        this.JPY = 0
        console.log('BTC ', this.btc, ' JPY', this.JPY, ' Profit ', Math.round(this.btc * this.tickPrice + this.JPY))
        await Sleep(500)
        numTick = 0
        tradeTime++
        continue
      }
      if (bear) {
        console.log('Tick:', numTick, ' Sell:', tradeAmount, ' Price:', this.tickPrice, ' Profit:', Math.round(this.btc * this.tickPrice + this.JPY), now.toLocaleString())
        this.btc = 0
        this.JPY = Math.round(this.tickPrice * tradeAmount)
        console.log('BTC ', this.btc, ' JPY', this.JPY, ' Profit ', Math.round(this.btc * this.tickPrice + this.JPY))
        await Sleep(500)
        numTick = 0
        tradeTime++
        continue
      }



      return this.btc * this.tickPrice + this.JPY

      // // 下单力度计算
      // //  1. 小成交量的趋势成功率比较低，减小力度
      // //  2. 过度频繁交易有害，减小力度
      // //  N. 小于或高于历史最高（最低）价时减小力度
      // //  3. 短时价格波动过大，减小力度
      // //  4. 盘口价差过大，减少力度
      // if (this.vol * this.tickPrice < Burst_Threshold_Value) tradeAmount *= this.vol * this.tickPrice / Burst_Threshold_Value
      // if (numTick < 5) tradeAmount *= 0.8
      // if (numTick < 10) tradeAmount *= 0.8
      // if (bull && this.tickPrice < max(this.prices)) tradeAmount *= 0.90
      // if (bear && this.tickPrice > min(this.prices)) tradeAmount *= 0.90
      // if (Math.abs(this.tickPrice - this.prices[this.prices.length - 2]) > burstPrice * 2) tradeAmount *= 0.90
      // if (Math.abs(this.tickPrice - this.prices[this.prices.length - 2]) > burstPrice * 3) tradeAmount *= 0.90
      // if (Math.abs(this.tickPrice - this.prices[this.prices.length - 2]) > burstPrice * 4) tradeAmount *= 0.90
      // if (orderBook.Asks[0].Price - orderBook.Bids[0].Price > burstPrice * 2) tradeAmount *= 0.90
      // if (orderBook.Asks[0].Price - orderBook.Bids[0].Price > burstPrice * 3) tradeAmount *= 0.90
      // if (orderBook.Asks[0].Price - orderBook.Bids[0].Price > burstPrice * 4) tradeAmount *= 0.90

      // // 执行订单
      // // BitFlyer订单状态
      // // ACTIVE: open orders
      // // COMPLETED: fully completed orders
      // // CANCELED: orders that have been cancelled by the customer
      // // EXPIRED: order that have been cancelled due to expiry
      // // REJECTED: failed orders

      // var tradePrice = bull ? this.bidPrice : this.askPrice
      // while (tradeAmount >= Min_Stock) {
      //   // 下单，考虑设置time_in_force参数为IOC（立即成交否则取消）
      //   var orderId = bull ? exchange.Buy(this.bidPrice, tradeAmount) : exchange.Sell(this.askPrice, tradeAmount)

      //   await Sleep(200)
      //   if (orderId) {
      //     this.tradeOrderId = orderId
      //     var order = null

      //     //下单后等待200毫秒就尝试取消订单，估计是当部分成交后主动取消其余为成交部分，
      //     //可能是原来的交易所不支持立即成交否则自动取消这种类型的订单
      //     while (true) {
      //       order = exchange.GetOrder(orderId)
      //       if (order) {
      //         if (order.Status == ORDER_STATE_PENDING) {
      //           exchange.CancelOrder(orderId)
      //           await Sleep(200)
      //         } else {
      //           break
      //         }
      //       }
      //     }
      //     this.tradeOrderId = 0
      //     tradeAmount -= order.DealAmount
      //     if (order.Status == ORDER_STATE_CLOSED && order.DealAmount != 0) {
      //       this.orders.push(order)
      //     }
      //     tradeAmount *= 0.9
      //     _updateProfit()
      //     if (order.Status == ORDER_STATE_CANCELED) {
      //       _updateOrderBook()
      //       while (bull && this.bidPrice - tradePrice > 0.1) {
      //         tradeAmount *= 0.99
      //         tradePrice += 0.1
      //       }
      //       while (bear && this.askPrice - tradePrice < -0.1) {
      //         tradeAmount *= 0.99
      //         tradePrice -= 0.1
      //       }
      //     }
      //   }
      // }
      numTick = 0
    }
  }

  async writeRecord(filetype) {
    // 可写流有缓存区的概念
    // 1.第一次写入是真的向文件里写，第二次在写入的时候是放到了缓存区里
    // 2.写入时会返回一个boolean类型，返回为false时表示缓存区满了，不要再写入了
    // 3.当内存和正在写入的内容消耗完后，会触发一个drain事件
    //let fs = require('fs');
    //let rs = fs.createWriteStream({...});//原生实现可写流

    let currentName = ''
    if (filetype == 'record') {
      var dataBuff = this.K_WriteBuff
    }
    if(filetype == 'executions'){
      var dataBuff = this.exec_WriteBuff
    }
    while(true && this.isRunning ){
      if (dataBuff[0] == undefined){
        //console.log('@375',dataBuff)
        if (filetype == 'record') await Sleep(1000*60)
        if (filetype == 'executions')  await Sleep(200)
        continue;
      }
      if(dataBuff.length == 0){
        await Sleep(200)
        continue;
      }
      var tickTime = new Date(dataBuff[0].Time);
      var YMDH =  tickTime.Format('yyyyMMddhh')
      let fileName = filetype + YMDH + '.txt'      
      
      if (fileName != currentName) {
        if (ws) ws.destroy()
        var ws = new WS('./data/' + fileName, {
          flags: 'w', // 写入文件，默认文件不存在会创建
          highWaterMark: 1, // 设置当前缓存区的大小
          encoding: 'utf8', // 文件里存放的都是二进制
          start: 0,
          autoClose: true, // 自动关闭文件描述符
          mode: 0o666, // 可读可写
        });
        currentName = fileName
      }
      
      var flag = ws.write(JSON.stringify(dataBuff[0])+'\r\n '); // 987 // 654 // 321 // 0
      dataBuff.splice(0,1)
      
    }
    return 'Write over'
    
  }

}

module.exports = MainServer;