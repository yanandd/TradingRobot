const { Worker, MessageChannel } = require('worker_threads');
const talib = require('talib');
const httpApi = require('./httpAPI')

const log4js = require('log4js');
log4js.configure("./src/log4js.json");
const logger = log4js.getLogger('tradering');
const logprofit = log4js.getLogger('profit');

const ConfigManager = require('./ConfigManager');
const WS = require('./worker/WriteStream')

const path = require('path');
const Burst_Threshold_Value = 1000000 //价格突破时成交金额考量阈值 小于此阈值意味着价格突破时成交金额过小，成功率会较低 初始值为1万美元
const Min_Stock = 0.005  //最小交易金额 原始预设为0.01
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
    if ((arr1[i] > arr2[i] && arr1[i - 1] > arr2[i - 1]) || (arr1[i] < arr2[i] && arr1[i - 1] < arr2[i - 1])) {
      continue;
    }

    if (arr1[i] >= arr2[i] && arr1[i - 1] < arr2[i - 1]) {
      //金叉 
      res.push(arr1.length - i)
      //console.log(arr1[i],arr2[i])
    }

    if (arr1[i] <= arr2[i] && arr1[i - 1] > arr2[i - 1]) {
      //死叉
      res.push(-(arr1.length - i))
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
    console.log({ Running_In_MODE: this.MODE })
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
      this.bidPrice = this.tick.best_bid + 200
      this.askPrice = this.tick.best_ask - 200
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
                if (this.marketData.open.length > 2000) {
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
    
    this.writeRecord('record')
    this.writeRecord('executions')
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
    var arr1 = [10, 20, 30, 40, 50, 60, 70, 80, 95, 130]
    var arr2 = [20, 30, 40, 50, 60, 70, 80, 85, 90, 140]//[25,35,40,45,48,55,60,75,90,140]
    var res = Cross(arr1, arr2)
    var logprofit = log4js.getLogger('profit');
    logprofit.info('test交易结果')
    return res
  }

  sendOrder = async (side,size,price)=>{
    this.test()
    var orderInfo = {
      product_code: "FX_BTC_JPY",
      child_order_type: "LIMIT",
      side: side,
      price: price,
      size: size,
      minute_to_expire: 10000,
      time_in_force: "GTC"
    }
    var orderID = await httpApi.sendOrder(orderInfo)
    orderID = JSON.parse(orderID)
    if (orderID && orderID.child_order_acceptance_id != undefined){
        return orderID.child_order_acceptance_id
    }else{
      return false
    }
  }

  buildConfigManager() {
    this.configManager = new ConfigManager(path.join(__dirname, '../'));
    this.config = this.configManager.load();

    if (this.config === false) {
      console.error('Missing config.json, have you run: npm run config');
      process.exit(0);
    }
  }

  async getAccount(){
    var position = await httpApi.getPosition()
    var collateral = await httpApi.getcollateral()
    var buySize = 0;
    var sellSize = 0;
    var buyJPY = 0;
    var sellJPY = 0;
    position.forEach((pos)=>{
      if (pos.side == 'BUY'){
        buySize += parseFloat(pos.size)
        buyJPY += parseFloat(pos.size) * parseFloat(pos.price)
      }
      if (pos.side == 'SELL'){
        sellSize += parseFloat(pos.size)
        sellJPY += parseFloat(pos.size) * parseFloat(pos.price)
      }
    })
    var SellPrice = sellSize != 0 ? sellJPY/sellSize:0
    var Buy_Price = buySize != 0 ? buyJPY/buySize:0
    var JPY = Math.round(collateral.JPY - collateral.require_JPY + collateral.open_profit) - 10
    return {
      CollateralJPY:collateral.JPY,
      JPY:JPY,
      SELL_btc:sellSize,
      SELL_Price :SellPrice,
      BUY_btc:buySize,
      BUY_Price:Buy_Price,
      Profit:collateral.open_profit,
      Require_JPY:collateral.require_JPY
    }
  }

  async startTrade() {
    this.numTick = 0
    this.checkLen = 6//Price_Check_Length
    this.preProfit = 0
    this.trading = false
    this.profitTime = new Date().getTime()
    this.lastTrade //上一次交易   
    logprofit.info('交易开始')
    logger.debug('交易开始');
    this.lastK = null //上一回轮询的时候的K线
    var exchangeStatue = JSON.parse(await httpApi.getHealth().then((result) => { return result }))
    var tradeTime = new Date().getTime()
    this.Account = await this.getAccount()
    logprofit.info(this.Account)
    while (true) {
      //轮询间隔200毫秒
      await Sleep(200)
      if (exchangeStatue && 'STOP' != exchangeStatue.status) {
        //交易所正常时，进入轮询
        await this.trader()
        //每2分钟检查一下交易所状态，如果STOP了需要等待交易正常后再重启轮询
        var nowTime = new Date().getTime()
        if (nowTime - tradeTime > 1000 * 60 * 2) {
          tradeTime = nowTime
          exchangeStatue = JSON.parse(await httpApi.getHealth().then((result) => { return result }))
        }
      } else {
        //交易所不正常时，停止轮询直到正常
        await Sleep(30000)
        logger.debug('交易所暂停交易中')
        exchangeStatue = JSON.parse(await httpApi.getHealth().then((result) => { return result }))
        if (exchangeStatue && 'STOP' != exchangeStatue.status){
          this.tickworker.postMessage({ port: this.tickPort.port2, mode: this.MODE }, [this.tickPort.port2]);
          this.execworker.postMessage({ port: this.executionsPort.port2, mode: this.MODE }, [this.executionsPort.port2]);
        }
      }
    }
  }

  /**
   * trader
   *
   * @returns
   * @memberof MainServer
   */
  async trader() {
    var tradeSide =''
    var tradeAmount = 0//交易数量  
    var tradePrice = 0 //交易日元  
    var crossResult
    var burstPrice
    var bull = false //做多
    var bear = false //做空

    if (!this.K || this.K.length < 60) {
      logger.debug('K线长度不足');
      await Sleep(60000)
      return false
    }
    // if (this.trading) {
    //   //logger.debug('正在交易，等待200毫秒');
    //   await Sleep(200)
    //   return false
    // }
    try {
      this.numTick++
      var nowProfit = this.Account.Profit;
      var nowTime = new Date().getTime()

      //每60秒输出一次盈亏，刷新一下账号信息
      if ((this.Account.BUY_btc != 0 || this.Account.SELL_btc !=0) && nowTime - this.profitTime > 60000) {
        this.Account = await this.getAccount()
        logger.debug({
          BTC: this.Account.BUY_btc == 0?this.Account.SELL_btc:this.Account.BUY_btc,
          Asset: this.Account.JPY+this.Account.require_JPY+this.Account.Profit,
          Profit: Math.round(nowProfit),
          ProfitDiff: Math.round(nowProfit - this.preProfit)
        })
        this.profitTime = nowTime
        this.preProfit = nowProfit
      }

      //止盈*止损*平衡保证金 最牛逼的地方就是这里
      try {
        if (this.Account.BUY_btc !=0 || this.Account.SELL_btc != 0){
          var side =this.Account.BUY_btc==0?'SELL':'BUY'
          var Btc = this.Account.BUY_btc==0?this.Account.SELL_btc:this.Account.BUY_btc
          var P0 = Math.round(this.Account.Require_JPY/Btc)
          var P1 = this.prices[this.prices.length-1]
          var dtBtc = ((2*P0-P1)*Btc-this.Account.CollateralJPY)/(P1-2*P0)
          if (dtBtc > 0.001){
            tradeAmount = dtBtc
            if (side == 'BUY') {
              var orderID = await this.sendOrder('SELL', tradeAmount)
            } else if (this.lastTrade.side == 'SELL') {
              var orderID = await this.sendOrder('BUY', tradeAmount)
            }
            if (orderID) {
              Sleep(300)
              var confirmFlg = false
              var times = 0
              var confirm = ()=>{httpApi.confirmOrder(orderID).then(async res => {
                times++
                logger.debug('平衡保证金时',res)
                if (res && res.length > 0) {
                  confirmFlg = true
                  res.forEach(el => {
                    logger.debug('止盈 --- BTC ', el.size, ' Side', el.side, ' Price', el.price)
                    logprofit.info('止盈 --- BTC ', el.size, ' Side', el.side, ' Price', el.price)
                  })
                }
                this.Account = await this.getAccount()
              })
              if (confirmFlg == false && times<5)
              {
                logger.debug('平衡保证金时,确认订单次数：',times)
                setTimeout(confirm,500)
              }

            }
            setTimeout(confirm,100)
            }
          }
        }
      } catch (err) {
        logger.debug('止盈代码有问题', err)
      }
        


      /// EMA
      var timePeriod = this.marketData.close.length > 99 ? 99 : this.marketData.close.length - 15
      var emaData = this.marketData.close
      emaData.push(this.prices[this.prices.length - 1])
      var EMA5 = talib.execute({
        name: "EMA",
        startIdx: 0,
        endIdx: emaData.length - 1,
        inReal: emaData,
        optInTimePeriod: 5
      }).result.outReal;

      var EMA9 = talib.execute({
        name: "EMA",
        startIdx: 0,
        endIdx: emaData.length - 1,
        inReal: emaData,
        optInTimePeriod: timePeriod
      }).result.outReal;

      var EMA_length = EMA9.length <= 180 ? EMA9.length : 180;
      var EMA51 = EMA5.slice(-EMA_length)
      var EMA91 = EMA9.slice(-EMA_length)

      crossResult = Cross(EMA51, EMA91)
      // if (crossResult.length == 0) {
      //   logger.debug('EMA51：', EMA51)
      //   logger.debug('EMA91：', EMA91)
      // }

      if (crossResult.length > 0 && crossResult[0] < 10) {
        logger.debug('快线' + (crossResult[0] > 0 ? '上' : '下') + '穿慢线在 ', crossResult[0], ' 轮之前', ' timePeriod:', timePeriod)
        logger.debug('EMA5分线最后价格：', EMA5[EMA5.length - 1], ' EMA100分线最后价格：', EMA9[EMA9.length - 1])

        //交叉发生在5分钟之内
        if (crossResult[0] > 0 && crossResult[0] < 5) {
          bull = true
        } else if (crossResult[0] < 0 && crossResult[0] > -5) {
          bear = true
        }
      }
      

      // 多空力量监测
      var diffRate = 1.5
      var currentVol_Buy = this.VolMinusBuy;
      var currentVol_Sell = this.VolMinusSell;
      var LastVol_Buy = this.VolBuy[this.VolBuy.length - 1]
      var LastVol_Sell = this.VolSell[this.VolSell.length - 1]
      var HVol_Buy = max(this.VolBuy.slice(this.VolBuy.length - this.checkLen))//上一轮tick的历史最高量价
      var HVol_Sell = max(this.VolSell.slice(this.VolSell.length - this.checkLen))//上一轮tick的历史最高量价
      var avgVol_Buy = avg(this.VolBuy.slice(this.VolBuy.length - this.checkLen))
      var avgVol_Sell = avg(this.VolSell.slice(this.VolSell.length - this.checkLen))

      if (this.Account.BUY_btc != 0)
      var actJPY = (this.Account.CollateralJPY - this.Account.Require_JPY + (this.prices[this.prices.length-1]*this.Account.BUY_btc - this.Account.Require_JPY )) * 0.95
      if (this.Account.SELL_btc != 0)
      var actJPY = (this.Account.CollateralJPY - this.Account.Require_JPY + (this.Account.Require_JPY - this.prices[this.prices.length-1]*this.Account.SELL_btc )) * 0.95
      //如果三分钟内有交叉信号
      //判断当前买卖力量
      if (bull && (currentVol_Buy > currentVol_Sell * diffRate || (currentVol_Buy > currentVol_Sell && LastVol_Buy > LastVol_Sell))) {
        //判断为买入
        tradeSide = 'BUY'
        
        tradeAmount = this.Account.SELL_btc != 0?this.Account.SELL_btc:(actJPY / this.bidPrice )
        logger.debug('金叉++++++++++++++')
      }
      if (bear && (currentVol_Sell > currentVol_Buy * diffRate || (currentVol_Sell > currentVol_Buy && LastVol_Sell > LastVol_Buy))) {
        //判断为卖出
        tradeSide = 'SELL'
        tradeAmount = this.Account.BUY_btc != 0?this.Account.BUY_btc:(actJPY / this.askPrice )
        logger.debug('死叉++++++++++++++')
      }

      //输出一下为什么没判断出交易点
      if ((bull || bear) && tradeAmount == 0){
        logger.debug('没有交易的原因',{
          currentVol_Buy : this.VolMinusBuy,
          currentVol_Sell : this.VolMinusSell,
          LastVol_Buy : this.VolBuy[this.VolBuy.length - 1],
          LastVol_Sell : this.VolSell[this.VolSell.length - 1],
          HVol_Buy : max(this.VolBuy.slice(this.VolBuy.length - this.checkLen)),//上一轮tick的历史最高量价
          HVol_Sell: max(this.VolSell.slice(this.VolSell.length - this.checkLen))
        })
      }

      // 发生逆转的  5分钟内价格逆转的情况   
      //指标信号为空头，但突然逆转：当前最高价击穿5分均线且为3分钟内连续新高
      var currentMaxPrice = max(this.tickInMinus)
      if (crossResult[0] < 0 
        && currentMaxPrice > EMA5[EMA5.length-1] 
        && currentMaxPrice >= min(this.marketData.high.slice(-2) )
        && this.marketData.high[this.marketData.high.length-1] > this.marketData.high[this.marketData.high.length-2]) {
          bear = false
          bull = true
          tradeSide = 'BUY'
          tradeAmount = this.Account.SELL_btc != 0?this.Account.SELL_btc:(actJPY / this.bidPrice)
          logger.debug('死叉被逆转++++++空转多')
      }
      //指标信号为多头，但突然逆转：当前最低价击穿5分均线且为3分钟内新低
      var currentMinPrice = min(this.tickInMinus)
      if (crossResult[0] > 0 
        && currentMinPrice < EMA5[EMA5.length-1] 
        && currentMinPrice <= min(this.marketData.low.slice(-2))
        && this.marketData.low[this.marketData.low.length-1] < this.marketData.low[this.marketData.low.length-2])  {
          bear = true
          bull = false
          tradeSide = 'SELL'
          tradeAmount = this.Account.BUY_btc != 0?this.Account.BUY_btc:(actJPY / this.askPrice)
          logger.debug('金叉被逆转++++++多转空')
      }

      //指标信号在三分钟内由于量价关系没有交易，但三分钟后有量价信号时
      if (!bear && !bull && crossResult && crossResult.length > 0) {
        if (crossResult[0] > 0 && LastVol_Buy > LastVol_Sell * diffRate && HVol_Buy > HVol_Sell * diffRate && avgVol_Buy > avgVol_Sell * diffRate) {
          bull = true
          tradeSide = 'BUY'
          tradeAmount = this.Account.SELL_btc != 0?this.Account.SELL_btc:(actJPY / this.bidPrice)
          logger.debug('多头转强 买入')
        }
        if (crossResult[0] < 0 && LastVol_Sell > LastVol_Buy * diffRate && HVol_Sell > HVol_Buy * diffRate && avgVol_Sell > avgVol_Buy * diffRate) {
          bear = true
          tradeSide = 'SELL'
          tradeAmount = this.Account.BUY_btc != 0?this.Account.BUY_btc:(actJPY / this.askPrice)
          logger.debug('空头转强 卖出')
        }
      }

      //多空逆转，且有持仓的情况，立即清仓
      if (crossResult[0] < 0 && this.lastTrade.side == 'BUY'){
        bear = true
        tradeSide = 'SELL'
        tradeAmount = this.Account.BUY_btc != 0?this.Account.BUY_btc:(actJPY / this.askPrice)
        logger.debug('多空逆转 清多头仓位')
      }
      if (crossResult[0] > 0 && this.lastTrade.side == 'SELL'){
        tradeSide = 'BUY'
        tradeAmount = this.Account.SELL_btc != 0?this.Account.SELL_btc:(actJPY / this.bidPrice)
        logger.debug('多空逆转 清空头仓位')
      }     

      if (tradeAmount < Min_Stock) {
        //console.log(this.numTick)
        return false
      }
      try{
      if (tradeSide != '' && tradeAmount >= Min_Stock) {
        if(tradeAmount>0.1) {
          tradeAmount=0.1 //先交易0.1个，剩下的会在下一轮轮询时交易完毕
        }
        tradePrice = tradeSide=='BUY'?this.bidPrice:this.askPrice
        var orderID = await this.sendOrder(tradeSide,tradeAmount,tradePrice)
        if (orderID){
          await Sleep(300)
          httpApi.confirmOrder(orderID).then(async res=>{            
            if (res && res.length>0 ){
              res.forEach(el=>{
                logger.debug('交易 --- BTC ', tradeAmount, ' Side', tradeSide, ' Price', el.price)
                logprofit.info('交易 --- BTC ', tradeAmount, ' Side', tradeSide, ' Price', el.price)
              })
              this.Account = await this.getAccount()
            }            
          })          
        }
        this.lastTrade = { side: tradeSide}
        await Sleep(200)
        this.numTick = 0
        tradeTime++
      }
    }
    catch(err){
      logger.debug('交易代码有问题',err)
    }
      return { side: tradeSide,tradeAmount:tradeAmount}
    }
    catch{
      return false
    }
  }


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

  async writeRecord(filetype) {
    // 可写流有缓存区的概念
    // 1.第一次写入是真的向文件里写，第二次在写入的时候是放到了缓存区里
    // 2.写入时会返回一个boolean类型，返回为false时表示缓存区满了，不要再写入了
    // 3.当内存和正在写入的内容消耗完后，会触发一个drain事件
    //let fs = require('fs');
    //let rs = fs.createWriteStream({...});//原生实现可写流
    if (this.MODE != 'DEBUG' && this.MODE != 'REALTIME') {
      return
    }
    if (this.MODE == 'DEBUG') {
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