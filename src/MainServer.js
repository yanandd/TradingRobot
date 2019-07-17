const { Worker, MessageChannel } = require('worker_threads');
var talib = require('talib');
var log4js = require('log4js');

log4js.configure("./src/log4js.json");

const ConfigManager = require('./ConfigManager');
let WS = require('./worker/WriteStream')
const httpApi = require('./httpAPI')
const path = require('path');
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
    if (new RegExp("(" + k + ")").test(fmt)) {
      if (k == "y+") {
        fmt = fmt.replace(RegExp.$1, ("" + o[k]).substr(4 - RegExp.$1.length));
      }
      else if (k == "S+") {
        var lens = RegExp.$1.length;
        lens = lens == 1 ? 3 : lens;
        fmt = fmt.replace(RegExp.$1, ("00" + o[k]).substr(("" + o[k]).length - 1, lens));
      }
      else {
        fmt = fmt.replace(RegExp.$1, (RegExp.$1.length == 1) ? (o[k]) : (("00" + o[k]).substr(("" + o[k]).length)));
      }
    }
  }
  return fmt;
}

var max = function (arr) {
  if (arr instanceof Array) {
    return Math.max(...arr)
  } else {
    throw 'max function Error!'
  }
}
var min = function (arr) {
  if (arr instanceof Array) {
    return Math.min(...arr)
  } else {
    throw 'min function Error!'
  }
}
var avg = function (arr) {
  if (arr instanceof Array) {
    var average = arr => arr.reduce((acc, val) => acc + val, 0) / arr.length;
    return average
  } else {
    throw 'max function Error!'
  }
}
// arr1 定义为 快线 指标数组，arr2 定义为慢线指标数组时
// 返回上穿的周期数组. 正数为上穿周数, 负数表示下穿的周数, 0指当前价格一样
var Cross = function (arr1, arr2) {            // 参数个数为2个，从参数名可以看出，这两个 参数应该都是 数组类型，数组就
  // 好比是 在X轴为 数组索引值，Y轴为 指标值的 坐标系中的 线段， 该函数就是判断 两条线的 交叉情况 
  if (arr1.length !== arr2.length) {      // 首先要判断 比较的两个 数组 长度是否相等
    throw "array length not equal";     // 如果不相等 抛出错误，对于 不相等 的指标线  无法 判断相交
  }
  
  var res = []
  for (var i = arr1.length - 1; i > 0; i--) {      // 遍历 数组 arr1， 遍历顺序 为 从最后一个元素 向前 遍历
    if (typeof (arr1[i]) !== 'number' || typeof (arr2[i]) !== 'number') { // 当 arr1 或者 arr2 任何一个数组 为 非数值类型 （即 无效指标） 时，跳出 遍历循环。
      throw 'array type error'
      break;                                  // 跳出循环
    }
    //没发生交叉
    if ((arr1[i] > arr2[i] && arr1[i-1] > arr2[i-1]) || (arr1[i] < arr2[i] && arr1[i-1] < arr2[i-1])){
      continue;
    }      

    if (arr1[i] >= arr2[i] && arr1[i-1] < arr2[i-1]){
      //金叉 
      res.push(arr1.length-i)
      //console.log(arr1[i],arr2[i])
    }
    
    if (arr1[i] <= arr2[i] && arr1[i-1] > arr2[i-1]){
      //死叉
      res.push(-(arr1.length-i))
      //console.log(arr1[i],arr2[i])
    }
  }
  return res;                                       
};

var Sleep = async function (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

class MainServer {
  constructor() {
    this.buildConfigManager();
    this.MODE = this.config.mode// DEBUG or REALTIME
    console.log({Running_In_MODE :this.MODE})
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
    this.VolMinusSell = 0
    this.VolMinusBuy = 0
    this.VolBuy = []
    this.VolSell = []
    this.orderBook
    this.bidPrice
    this.askPrice
    this.lastPrice
    this.JPY = 100000;
    this.btc = 0
    this.tickTime = ''
    this.K_WriteBuff = []
    this.exec_WriteBuff = []
    this.marketData = { open: [], close: [], high: [], low: [], volume: [] }

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

    });

    this.executionsPort.port1.on('message', (message) => {
      //console.log(message.message.replace(/"/g,''),11111)
      this.executions = eval(message.message)
      if (this.MODE == 'DEBUG') {
        console.log('DEBUG')        
      } else {
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
                this.marketData.open.push(k.Open)
                this.marketData.close.push(k.Close)
                this.marketData.high.push(k.High)
                this.marketData.low.push(k.Low)
                this.marketData.volume.push(k.Volume)
                if (this.marketData.open.length > 2000){
                  this.marketData.open.shift()
                  this.marketData.close.shift()
                  this.marketData.high.shift()
                  this.marketData.low.shift()
                  this.marketData.volume.shift()
                  this.K.shift()
                }
                
                this.VolBuy.push(this.VolMinusBuy)
                this.VolSell.push(this.VolMinusSell)
                if (this.VolBuy.length > 2000) {
                  this.VolBuy.shift()
                }
                if (this.VolSell.length > 2000) {
                  this.VolSell.shift()
                }                

                this.tickInMinus = []
                this.tickVolMinus = 0
                this.VolMinusBuy = 0                
                this.VolMinusSell = 0

              }
            } else {
              this.tickVolMinus += el.size
              this.tickInMinus.push(el.price)
              if (el.side == 'BUY')
                this.VolMinusBuy += parseFloat(el.size)
              else
                this.VolMinusSell += parseFloat(el.size)
              //console.log(this.VolPriceMinus)
            }
            //exec_date:2019-07-14T15:10:41.18609Z
          });
        }
      }
    });

    this.tickworker.postMessage({ port: this.tickPort.port2, mode: this.MODE }, [this.tickPort.port2]);
    this.execworker.postMessage({ port: this.executionsPort.port2, mode: this.MODE }, [this.executionsPort.port2]);

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
    var arr1 = [10,20,30,40,50,60,70,80,95,130]
    var arr2 = [20,30,40,50,60,70,80,85,90,140]//[25,35,40,45,48,55,60,75,90,140]
    var res = Cross(arr1,arr2)
    var logprofit = log4js.getLogger('profit');
    logprofit.info('交易结果')
    return res
  }

  buildConfigManager() {
    this.configManager = new ConfigManager(path.join(__dirname, '../'));
    this.config = this.configManager.load();

    if (this.config === false) {
      console.error('Missing config.json, have you run: npm run config');
      process.exit(0);
    }
  }

  /**
   * trader
   *
   * @returns
   * @memberof MainServer
   */
  async trader() {
    var logger = log4js.getLogger('tradering');
    var logprofit = log4js.getLogger('profit');
    logprofit.info('交易结果')
    logger.debug('交易开始');
    var numTick = 0
    var checkLen = 6//Price_Check_Length
    var bull //做多
    var bear //做空
    var powerUp
    var powerDown
    var tradeTime = 0
    var tradeAmount = 0//交易数量
    var nowProfit = 0
    var preProfit = 0
    var burstPrice
    var trading = false
    var profitTime = new Date().getTime()
    var indTime = new Date().getTime()
    var lastTrade //上一次交易
    var crossResult
    while (tradeTime < 10000) {
      if (this.K.length < 10) {
        logger.debug('K线长度不足');
        await Sleep(60000)
        continue
      }
      if (trading) {
        //logger.debug('正在交易，等待200毫秒');
        await Sleep(200)
        continue
      }
      numTick++
      nowProfit = Math.round(this.btc * this.tickPrice + this.JPY)
      var nowTime = new Date().getTime()
      //每10秒输出一次盈亏
      if (this.btc != 0 && nowTime - profitTime > 10000) {
          logger.info({
            BTC: this.btc, 
            JPY: this.JPY,
            Profit: nowProfit,
            ProfitDiff:nowProfit-preProfit})
          profitTime = nowTime
          preProfit = nowProfit
      }

      if (lastTrade){
        if (nowProfit>lastTrade.profit*1.009){
          trading = true
          logger.debug('锁定盈利 --- BTC ', this.btc, ' JPY', this.JPY, ' Profit ', Math.round(this.btc * this.tickPrice + this.JPY))
          logprofit.info('锁定盈利 --- BTC ', this.btc, ' JPY', this.JPY, ' Profit ', Math.round(this.btc * this.tickPrice + this.JPY))
          if (lastTrade.side == 'BUY'){
            this.JPY = this.btc * this.tickPrice
            this.btc = 0            
            lastTrade = null            
          }
          if (lastTrade.side == 'SELL'){
            // 目前还没考虑做空，所以这里没有处理
            // this.btc = 0
            // this.JPY = this.btc * this.tickPrice
            lastTrade = null            
          }
          trading = false
        }
      }


      bull = false
      bear = false
      powerDown = false
      powerUp = false

      /// EMA
      // 每60秒检查一次K线
      if (nowTime - indTime > 59000) {
        indTime = nowTime
        var timePeriod = this.marketData.close.length > 99?99:this.marketData.close.length
        var EMA5 = talib.execute({
          name: "EMA",
          startIdx: 0,
          endIdx: this.marketData.close.length - 1,
          inReal: this.marketData.close,
          optInTimePeriod: 5
        }).result.outReal;

        var EMA9 = talib.execute({
          name: "EMA",
          startIdx: 0,
          endIdx: this.marketData.close.length - 1,
          inReal: this.marketData.close,
          optInTimePeriod: timePeriod
        }).result.outReal;

        var EMA_length = EMA9.length <= 180?EMA9.length:180;
        var EMA51 = EMA5.slice(EMA5.length-EMA_length)
        var EMA91 = EMA9.slice(EMA9.length-EMA_length)
        crossResult = Cross(EMA51,EMA91)
        if (crossResult.length == 0){
          logger.debug('EMA51：', EMA51)
          logger.debug('EMA91：', EMA91)
        }
          
        if (crossResult.length > 0) {
          logger.debug('快线' + (crossResult[0] > 1 ? '上' : '下') + '穿慢线在 ', crossResult[0], ' 轮之前', ' timePeriod:', timePeriod)
          logger.debug('EMA5分线最后价格：', EMA5[EMA5.length - 1], ' EMA100分线最后价格：', EMA9[EMA9.length - 1])

          //交叉发生在三分钟之内
          if (crossResult[0] > 0 && crossResult[0] < 4) {
            bull = true
            //tradeAmount = this.JPY / this.bidPrice //* 0.9
          } else if (crossResult[0] < 0 && crossResult[0] > -4) {
            bear = true
            //tradeAmount = this.btc
          }
        }
      }

      // 多空力量监测
      var diffRate = 1.5
      var currentVol_Buy = this.VolMinusBuy;
      var currentVol_Sell = this.VolMinusSell;
      var LastVol_Buy = this.VolBuy[this.VolBuy.length-1]
      var LastVol_Sell = this.VolSell[this.VolSell.length-1]
      var HVol_Buy = max(this.VolBuy.slice(this.VolBuy.length - checkLen))//上一轮tick的历史最高量价
      var HVol_Sell = max(this.VolSell.slice(this.VolSell.length - checkLen))//上一轮tick的历史最高量价
      var avgVol_Buy = avg(this.VolBuy.slice(this.VolBuy.length - checkLen)) 
      var avgVol_Sell = avg(this.VolSell.slice(this.VolSell.length - checkLen))

      //如果三分钟内有交叉信号
      //判断当前买卖力量
      if (bull && (currentVol_Buy > currentVol_Sell*diffRate || (currentVol_Buy > currentVol_Sell && LastVol_Buy > LastVol_Sell)) ){
        //判断为买入
        tradeAmount = this.JPY / this.bidPrice //* 0.9
        logger.debug('金叉++++++++++++++')
      }
      if (bear && (currentVol_Sell > currentVol_Buy*diffRate || (currentVol_Sell > currentVol_Buy &&  LastVol_Sell > LastVol_Buy ))  ){
        //判断为卖出
        tradeAmount = this.btc
        logger.debug('死叉++++++++++++++')
      }

      // 发生逆转的  仅考虑3分钟内逆转的情况   
      //指标信号为空头，但当前多头力量大于过去5分钟平均量的3倍
      if (bear && currentVol_Buy > (avgVol_Buy+avgVol_Sell)*3){
        bear = false
        bull = true
        tradeAmount = this.JPY / this.bidPrice //* 0.9
        logger.debug('死叉++++被逆转++++++空转多')
      }
      //指标信号为多头，但当前空头力量大于过去5分钟平均量的3倍
      if (bull && currentVol_Sell > (avgVol_Buy+avgVol_Sell)*3){
        bear = true
        bull = false
        tradeAmount = this.btc
        logger.debug('金叉++++被逆转++++++多转空')
      }

      //指标信号在三分钟内由于量价关系没有交易，但三分钟后有量价信号时
      if (!bear && !bull && crossResult.length>0){
        if (crossResult[0]>0 && LastVol_Buy > LastVol_Sell*diffRate && HVol_Buy > HVol_Sell*diffRate && avgVol_Buy > avgVol_Sell*diffRate){
          bull = true
          tradeAmount = this.JPY / this.bidPrice //* 0.9
          logger.debug('多头转强 买入')
        }
        if (crossResult[0]<0 && LastVol_Sell > LastVol_Buy*diffRate && HVol_Sell > HVol_Buy*diffRate && avgVol_Sell> avgVol_Buy*diffRate){
          bear = true
          tradeAmount = this.btc
          logger.debug('空头转强 卖出')
        }
      }

     // 平衡策略 暂时没做
      var balance = async function () {
        if (trading) {
          await Sleep(200)
        }
      }

      if ((!bull && !bear) || tradeAmount < Min_Stock) {
        console.log(numTick)
        await Sleep(300)
        continue
      }

      trading = true
      if (bull) {
        logger.debug('Tick:', numTick, ' Buy:', tradeAmount, ' Price:', this.tickPrice, ' Profit:', Math.round(this.btc * this.tickPrice + this.JPY))
        logprofit.info('Tick:', numTick, ' Buy:', tradeAmount, ' Price:', this.tickPrice, ' Profit:', Math.round(this.btc * this.tickPrice + this.JPY))
        this.btc = this.btc + tradeAmount
        this.JPY = 0
        trading = false
        lastTrade = {side:'BUY',amount:tradeAmount,profit:Math.round(this.btc * this.tickPrice + this.JPY)}
        logger.debug('BTC ', this.btc, ' JPY', this.JPY, ' Profit ', Math.round(this.btc * this.tickPrice + this.JPY))
        await Sleep(200)
        numTick = 0
        tradeTime++
        continue
      }
      if (bear) {
        logger.debug('Tick:', numTick, ' Sell:', tradeAmount, ' Price:', this.tickPrice, ' Profit:', Math.round(this.btc * this.tickPrice + this.JPY))
        logprofit.info('Tick:', numTick, ' Sell:', tradeAmount, ' Price:', this.tickPrice, ' Profit:', Math.round(this.btc * this.tickPrice + this.JPY))
        this.btc = 0
        this.JPY = Math.round(this.tickPrice * tradeAmount)
        trading = false
        lastTrade = {side:'SELL',amount:tradeAmount,profit:Math.round(this.btc * this.tickPrice + this.JPY)}
        logger.debug('BTC ', this.btc, ' JPY', this.JPY, ' Profit ', Math.round(this.btc * this.tickPrice + this.JPY))
        await Sleep(200)
        numTick = 0
        tradeTime++
        continue
      }


      //这句话实际不会被执行
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
    if (this.MODE != 'DEBUG' && this.MODE != 'REALTIME'){
        return
    }
    if (this.MODE == 'DEBUG'){
      return
    }
    let currentName = ''
    if (filetype == 'record') {
      var dataBuff = this.K_WriteBuff
    }
    if (filetype == 'executions') {
      var dataBuff = this.exec_WriteBuff
    }
    while (true && this.isRunning) {
      if (dataBuff[0] == undefined) {
        //console.log('@375',dataBuff)
        if (filetype == 'record') await Sleep(1000 * 60)
        if (filetype == 'executions') await Sleep(200)
        continue;
      }
      if (dataBuff.length == 0) {
        await Sleep(200)
        continue;
      }
      var tickTime = new Date(dataBuff[0].Time);
      var YMDH = tickTime.Format('yyyyMMddhh')
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

      var flag = ws.write(JSON.stringify(dataBuff[0]) + '\r\n '); // 987 // 654 // 321 // 0
      dataBuff.splice(0, 1)

    }
    return 'Write over'

  }

}

module.exports = MainServer;