const talib = require('talib-binding')
const { Worker, MessageChannel } = require('worker_threads');
//const talib = require('talib');
const httpApi = require('./httpAPI')
const debugApi = require('./DebugAPI')
const BigNumber = require('bignumber.js');
BigNumber.config({ DECIMAL_PLACES: 6 })
const log4js = require('log4js');
log4js.configure("./src/log4js.json");
const logger = log4js.getLogger('tradering');
const logprofit = log4js.getLogger('profit');

const ConfigManager = require('./ConfigManager');
const WS = require('./worker/WriteStream')

const path = require('path');
const Burst_Threshold_Value = 1000000 //价格突破时成交金额考量阈值 小于此阈值意味着价格突破时成交金额过小，成功率会较低 初始值为1万美元
const Min_Stock = 0.01  //最小交易金额 原始预设为0.01
const Burst_Threshold_Pct = 0.0005 //价格突破比 原始预设为0.00005
const Price_Check_Length = 5 //比较价格是参考的历史价格数据长度 预设为6
const RUN_MODE = {
  DEBUG: 'debug',
  REALTIME: 'realtime'
} 
const EXCHANGE_NORMAL_STATUS = ['NORMAL', 'BUSY', 'VERY BUSY', 'SUPER BUSY']
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
// 返回上穿的周期数组. 正数为上穿周数, 负数表示下穿的周数,
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
  if (res.length == 0) {
    if (arr1[0] > arr2[0]) {
      res.push(arr1.length)
    } else {
      res.push(-(arr1.length))
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
    this.Lever = this.config.collateralLever //杠杆倍率
    console.log({ Running_In_MODE: this.MODE })
    this.isRunning = true;
    this.tickPort = new MessageChannel();
    this.executionsPort = new MessageChannel();
    this.BTC_JPY_Port = new MessageChannel();

    this.tickworker = new Worker('./src/worker/tickworker.js')
    this.execworker = new Worker('./src/worker/executionsworker.js')
    this.BTC_JPY_Execworker = new Worker('./src/worker/BTC_JPY_ExecutionsWorker.js')

    this.K = []
    this.K_30 = []
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

    //BTC用
    this.BTC_K = []
    //this.BTC_K_30 = []
    this.BTC_prices = [...Array(100)].map(_ => 0); // 历史成交价格
    this.BTC_vol = [] //历史成交量
    this.BTC_tickPrice //本轮tick价格
    this.BTC_tickInMinus = []
    this.BTC_tickVolMinus = 0
    this.BTC_VolMinusSell = 0
    this.BTC_VolMinusBuy = 0
    this.BTC_VolBuy = []
    this.BTC_VolSell = []
    this.BTC_orderBook
    this.BTC_bidPrice
    this.BTC_askPrice
    this.BTC_lastPrice
    this.BTC_tickTime = ''
    
    this.BTC_exec_WriteBuff = []
    this.BTC_marketData = { open: [], close: [], high: [], low: [], volume: [] }

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
      this.executionProcess(message.message)
    });

    this.BTC_JPY_Port.port1.on('message', (message) => {
      this.BTC_JPY_Process(message.message)
    });

    this.tickworker.postMessage({ port: this.tickPort.port2, mode: this.MODE }, [this.tickPort.port2]);
    this.execworker.postMessage({ port: this.executionsPort.port2, mode: this.MODE }, [this.executionsPort.port2]);
    this.BTC_JPY_Execworker.postMessage({ port: this.BTC_JPY_Port.port2, mode: this.MODE }, [this.BTC_JPY_Port.port2])

    if (this.MODE == RUN_MODE.REALTIME) {
      //this.writeRecord('record')
      //this.writeRecord('BTC_FX_Executions')
      //this.writeRecord('BTC_Executions')
    }
    //httpApi.getPosition()
    //httpApi.getCollateral()
  }

  BTC_JPY_Process(data) {
    if (this.MODE == RUN_MODE.REALTIME) {
      this.BTC_Executions = eval(data)
    } else if (this.MODE == RUN_MODE.DEBUG) {
      var execution = JSON.parse(data)
      this.BTC_Executions = [execution]
    }
    if (this.BTC_Executions instanceof Array) {
      this.BTC_Executions.forEach(el => {
        this.BTC_prices.shift()
        this.BTC_prices.push(el.price)
        el.Time = el.exec_date;
        var currentTime = el.exec_date.slice(11, 16);
        if (this.BTC_tickTime != currentTime) {
          //console.log(this.tickTime,currentTime)
          this.BTC_tickTime = currentTime;
          if (this.BTC_tickInMinus.length != 0) {
            var k = {
              Time: new Date(el.exec_date) - 1000,
              Open: this.BTC_tickInMinus[0],
              High: max(this.BTC_tickInMinus),
              Low: min(this.BTC_tickInMinus),
              Close: this.BTC_tickInMinus[this.BTC_tickInMinus.length - 1],
              Volume: this.BTC_tickVolMinus
            }
            this.BTC_K_WriteBuff.push(k)
            this.BTC_K.push(k);
            this.BTC_marketData.open.push(k.Open)
            this.BTC_marketData.close.push(k.Close)
            this.BTC_marketData.high.push(k.High)
            this.BTC_marketData.low.push(k.Low)
            this.BTC_marketData.volume.push(k.Volume)
            if (this.BTC_marketData.open.length > 2400) {
              this.BTC_marketData.open.shift()
              this.BTC_marketData.close.shift()
              this.BTC_marketData.high.shift()
              this.BTC_marketData.low.shift()
              this.BTC_marketData.volume.shift()
              this.BTC_K.shift()
            }
            this.BTC_VolBuy.push(this.BTC_VolMinusBuy.toFixed(0))
            this.BTC_VolSell.push(this.BTC_VolMinusSell.toFixed(0))
            if (this.BTC_VolBuy.length > 2400) {
              this.BTC_VolBuy.shift()
            }
            if (this.BTC_VolSell.length > 2400) {
              this.BTC_VolSell.shift()
            }
            //当整30分钟时取得30分钟K线
            // if (this.BTC_tickTime.slice(this.BTC_tickTime.length - 2) == '00' || this.BTC_tickTime.slice(this.BTC_tickTime.length - 2) == '30') {
            //   var tickInLastHalfHour = this.BTC_K.slice(this.BTC_K.length - 30)
            //   var k30 = {
            //     Time: new Date(el.exec_date) - 1000,
            //     Open: tickInLastHalfHour[0].Open,
            //     High: max(tickInLastHalfHour.map(function (item) { return item.High })),
            //     Low: min(tickInLastHalfHour.map(function (item) { return item.Low })),
            //     Close: tickInLastHalfHour[tickInLastHalfHour.length - 1].Close,
            //     Volume: tickInLastHalfHour.map(function (item) { return item.Volume }).reduce(function (pre, cur) { return pre + cur })
            //   }
            //   this.K_30.push(k30)
            //   if (this.K_30.length > 2400) {
            //     this.K_30.shift()
            //   }
            // }
            this.BTC_tickInMinus = []
            this.BTC_tickVolMinus = 0
            this.BTC_VolMinusBuy = 0
            this.BTC_VolMinusSell = 0
          }
        } else {
          // this.BTC_tickVolMinus += el.size
          // this.BTC_tickInMinus.push(el.price)
          // if (el.side == 'BUY')
          //   this.BTC_VolMinusBuy += parseFloat(el.size)
          // else
          //   this.BTC_VolMinusSell += parseFloat(el.size)
          //console.log(this.VolPriceMinus)
        }
        //exec_date:2019-07-14T15:10:41.18609Z
      });
    }
  }

  executionProcess(data) {
    if (this.MODE == RUN_MODE.REALTIME) {
      this.executions = eval(data)
    } else if (this.MODE == RUN_MODE.DEBUG) {
      var execution = JSON.parse(data.trim())
      this.executions = [execution]
      this.lastPrice = execution.price
      this.bidPrice = execution.price + 100
      this.askPrice = execution.price - 100
      this.tickPrice = Math.round((this.bidPrice + this.askPrice) / 2)
      //this.executionID = execution.id
    }
    if (this.executions instanceof Array) {
      this.executions.forEach(el => {
        this.prices.shift()
        this.prices.push(el.price)
        el.Time = el.exec_date;
        //if (this.MODE == RUN_MODE.DEBUG) {
        this.exec_WriteBuff.push(el) //只为取最近1分钟数据而用
        if (this.exec_WriteBuff.length > 500){
          this.exec_WriteBuff.shift()
        }
        //}
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
            //this.K_WriteBuff.push(k)
            this.K.push(k);
            // this.marketData.open.push(k.Open)
            // this.marketData.close.push(k.Close)
            // this.marketData.high.push(k.High)
            // this.marketData.low.push(k.Low)
            // this.marketData.volume.push(k.Volume)
            if (this.K.length > 2000) {
              // this.marketData.open.shift()
              // this.marketData.close.shift()
              // this.marketData.high.shift()
              // this.marketData.low.shift()
              // this.marketData.volume.shift()
              this.K.shift()
            }
            this.VolBuy.push(this.VolMinusBuy.toFixed(0))
            this.VolSell.push(this.VolMinusSell.toFixed(0))
            if (this.VolBuy.length > 2000) {
              this.VolBuy.shift()
            }
            if (this.VolSell.length > 2000) {
              this.VolSell.shift()
            }
            //当整30分钟时取得30分钟K线
            if (this.tickTime.slice(this.tickTime.length - 2) == '00' || this.tickTime.slice(this.tickTime.length - 2) == '30') {
              var tickInLastHalfHour = this.K.slice(this.K.length - 30)
              var k30 = {
                Time: new Date(el.exec_date) - 1000,
                Open: tickInLastHalfHour[0].Open,
                High: max(tickInLastHalfHour.map(function (item) { return item.High })),
                Low: min(tickInLastHalfHour.map(function (item) { return item.Low })),
                Close: tickInLastHalfHour[tickInLastHalfHour.length - 1].Close,
                Volume: tickInLastHalfHour.map(function (item) { return item.Volume }).reduce(function (pre, cur) { return pre + cur })
              }
              this.K_30.push(k30)
              if (this.K_30.length > 2400) {
                this.K_30.shift()
              }
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
          else if (el.side == 'SELL')
            this.VolMinusSell += parseFloat(el.size)
          //console.log(this.VolPriceMinus)
        }
        //exec_date:2019-07-14T15:10:41.18609Z
      });
    }
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
  async test() {

    var orderid = undefined
    orderid = await this.sendOrder('BUY', 0.01, 1300000)

    while (!orderid) {
      console.log('222', orderid)
    }
    console.log('111', orderid)
    // var b = debugApi.getPosition()
    // console.log('SELL after')
    // b.forEach((el)=> {return console.log(el.side,' ',el.size.toFixed(6),' ',el.price.toFixed(6))})    
    // //console.log(debugApi.getProfit(12500000).toString())
    // var acc = await this.getAccount()
    // console.log(acc.CollateralJPY.toString())

  }

  async sendOrder(side, size, price) {
    var orderInfo = {
      product_code: "FX_BTC_JPY",
      child_order_type: price ? "LIMIT" : "MARKET",
      side: side,
      price: price,
      size: size,
      minute_to_expire: 1,
      time_in_force: "GTC"
    }
    try {
      var res = await httpApi.sendOrder(orderInfo)
      var order = JSON.parse(res)
      if (size < Min_Stock) return false
      if (order && order.child_order_acceptance_id != undefined) {
        return order.child_order_acceptance_id
      } else {
        return false
      }
    }
    catch (err) {
      throw err
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

  async getAccount() {
    if (this.MODE == RUN_MODE.DEBUG) {
      var position = debugApi.getPosition()
      var collateral = debugApi.getCollateral()
    }
    if (this.MODE == RUN_MODE.REALTIME) {
      var position = await httpApi.getPosition()
      var collateral = await httpApi.getCollateral()
    }
    let buySize = new BigNumber(0);
    var sellSize = new BigNumber(0);
    var buyJPY = new BigNumber(0);
    var sellJPY = new BigNumber(0);
    if (position instanceof Array) {
      position.forEach((pos) => {
        if (pos.side == 'BUY') {
          let size = new BigNumber(pos.size)
          buySize = buySize.plus(size);
          buyJPY = buyJPY.plus(size.multipliedBy(pos.price))
        }
        if (pos.side == 'SELL') {
          let size = new BigNumber(pos.size)
          sellSize = sellSize.plus(size);
          sellJPY = sellJPY.plus(size.multipliedBy(pos.price))
        }
      })
    }
    var SellPrice = sellSize.comparedTo(0) != 0 ? sellJPY.idiv(sellSize) : new BigNumber(0)
    var BuyPrice = buySize.comparedTo(0) != 0 ? buyJPY.idiv(buySize) : new BigNumber(0)
    var JPY = BigNumber(collateral.JPY).minus(BigNumber(collateral.require_JPY).multipliedBy(this.Lever)).plus(collateral.open_profit)
    console.log('reset Account Info', 'BuySize=', buySize.toFixed(6), ' SellSize=', sellSize.toFixed(6))
    return {
      CollateralJPY: BigNumber(collateral.JPY),
      JPY: JPY,
      SELL_btc: sellSize,
      SELL_Price: SellPrice,
      BUY_btc: buySize,
      BUY_Price: BuyPrice,
      Profit: BigNumber(collateral.open_profit),
      Require_JPY: BigNumber(collateral.require_JPY)
    }
  }

  async getRemoteTicks() {
    // note: rpc-websockets supports auto-reconection.
    let WebSocket = require("rpc-websockets").Client;
    //let ws = new WebSocket("ws://localhost:8081");
    let ws = new WebSocket("ws://192.168.31.183:8080");
    try {
      ws.on("open", () => {
        // ws.call("subscribe", {
        //     channel: channelName
        // });
        console.log('opened')
        //ws.subscribe('tickUpdated')
        ws.call("getTicks").then(notify => {
          notify = notify.replace(/null/g, '0')
          var ticks = eval(notify)
          if (ticks instanceof Array) {
            console.log('getTicksM1 length=', ticks.length)
            this.K = ticks.slice()
            //this.marketData.close = ticks.map(function (item) { return item.Close })
            //console.log(this.K)
          }
        })
        ws.call("getTicksM30").then(notify => {
          notify = notify.replace(/null/g, '0')
          var ticks = eval(notify)
          if (ticks instanceof Array) {
            console.log('getTicksM30 length=', ticks.length)
            this.K_30 = ticks.slice()
            //this.marketData.close = ticks.slice()
            //console.log(this.K)
          }
        })

      });
    } catch (err) {
      logger.debug(err)
      throw err
    }
  }

  async startTrade() {
    this.numTick = 0
    this.tempM30K = null
    this.tempLastK = null
    this.balanceTimes = 1
    this.profitStopJPY = BigNumber(2000)
    this.crossPoint = 0
    this.diffMACD = []
    this.MaxProfit = BigNumber(0)
    this.MinProfit = BigNumber(0)
    this.confirmOrderList = []
    this.checkLen = 6//Price_Check_Length
    this.preProfit = 0
    this.trading = false
    this.profitTime = new Date().getTime()
    this.lastTrade //上一次交易   
    this.tradingTime = new Date().getTime()
    logprofit.info('交易开始：模式=', this.MODE)
    logger.debug('交易开始：模式=', this.MODE);
    this.lastK = null //上一回轮询的时候的K线
    var exchangeStatus = JSON.parse(await httpApi.getHealth())
    var tradeTimes = new Date().getTime()

    if (this.MODE == RUN_MODE.REALTIME) {
      this.Account = await this.getAccount()
      await this.getRemoteTicks()
    }
    //this.MaxAsset = BigNumber(0)
    this.errTimes = 0

    while (this.MODE == RUN_MODE.REALTIME && this.errTimes < 100) {
      //console.log('ErrTime',this.errTimes)
      //轮询间隔200毫秒
      await Sleep(200)
      if (exchangeStatus && EXCHANGE_NORMAL_STATUS.includes(exchangeStatus.status)) {
        //交易所正常时，进入轮询
        await this.trader()
        //每2分钟检查一下交易所状态，如果STOP了需要等待交易正常后再重启轮询
        var nowTime = new Date().getTime()
        if (nowTime - tradeTimes > 1000 * 60 * 2) {
          tradeTimes = nowTime
          exchangeStatus = JSON.parse(await httpApi.getHealth())
          console.log('交易所状态：', exchangeStatus)
        }
      } else {
        //交易所不正常时，停止轮询直到正常
        await Sleep(10000)
        logger.debug('交易所暂停交易中,等待自动恢复')
        exchangeStatus = JSON.parse(await httpApi.getHealth())
        console.log('交易所状态：', exchangeStatus)
      }
    }
    //实盘模式到此为止
    if (this.MODE == RUN_MODE.REALTIME)
      return

    //DEBUG mode
    debugApi.init()
    this.Account = await this.getAccount()

    logprofit.info({
      BUY_BTC: this.Account.BUY_btc.toFixed(6),
      SELL_BTC: this.Account.SELL_btc.toFixed(6),
      Asset: this.Account.CollateralJPY.plus(this.Account.Profit).toFixed(0),
    })
    var fs = require('fs');
    const LineByLine = require('./readlinesyn');

    var dir = path.join(__dirname, '../data/20190805/')

    //var liner = new LineByLine();
    var files = fs.readdirSync(dir);//同步读取文件夹
    var execfiles = files.filter((f) => {
      return f.startsWith('BTC_FX_Executions');
    });

    execfiles.sort(function (a, b) {
      return fs.statSync(dir + a).mtime.getTime() -
        fs.statSync(dir + b).mtime.getTime();
    });
    try {
      for (var index in execfiles) {
        var fileName = files[index];
        var liner = new LineByLine();
        console.log(fileName);

        liner.open(dir + fileName);
        var theline;
        while (!liner._EOF) {
          theline = liner.next();
          //console.log(String(theline) );
          if (theline == null) continue
          if (theline.trim().length == 0) continue
          this.BTC_JPY_Process(String(theline));
          this.executionProcess(String(theline));
          await this.trader()
          theline = undefined
        }
        liner.close();
        liner = undefined
      }
      this.Account = await this.getAccount()

      logprofit.info({
        BUY_BTC: this.Account.BUY_btc.toFixed(6),
        SELL_BTC: this.Account.SELL_btc.toFixed(6),
        Asset: this.Account.CollateralJPY.plus(this.Account.Profit).toFixed(0),
      })

    } catch (err) {
      console.log(fileName)
      console.log(theline)
      console.log(err)
      throw err
    }

  }

  /**
   *params:cancelOrderFlag
   *
   * @memberof MainServer
   */
  async checkActiveOrder(cancelOrderFlag) {
    //检查是否有未结订单，有则取消
    var res = await httpApi.getOrders()

    if (res.status == 'OK') {
      var orders = res.data
      if (orders.length > 0) {
        console.log('未结订单 件数=', orders.length)
        if (cancelOrderFlag == false) {
          return false
        }
        //需要取消未结订单
        orders.forEach((el) => {
          httpApi.cancelOrder(el.child_order_id).then(res => {
            if (res.status == 'OK') {
              logger.debug('已取消订单，OrderID=', el)
            } else {
              logger.debug('取消订单失败，OrderID=', el)
            }
          })
        })
        //异步调用后立即返回false，外部调用程序应该设为交易中状态
        return false
      } else {
        return true
      }
    } else {
      logger.debug('未结订单确认Error', res.data)
      this.errTimes++
      return true
    }
  }

  /**
   * trader
   *
   * @returns
   * @memberof MainServer
   */

  async trader() {
    var tradeSide = ''
    var tradeAmount = BigNumber(0)//交易数量  
    var tradePrice = 0 //交易日元  
    var lastPrice = BigNumber(this.prices[this.prices.length - 1])
    var requireRateMax = 1.02 //需要保证的必要保证金维持率
    var requireRateMin = 1.00 //需要保证的必要保证金维持率  
    var absBTC = BigNumber(0)
    var dtBtc = BigNumber(0)
    var profitStopJPYRate = 0.01
    if (this.prices.length < 20 || lastPrice == 0 || !this.K || this.K.length < 100 || this.K_30.length < 40) {
      console.log('K线长度不足，K_30.length =', this.K_30.length);
      if (this.MODE == RUN_MODE.REALTIME) await Sleep(60000)
      return false
    }

    try {
      this.numTick++
      var nowTime = new Date().getTime()
      //console.log('this.trading == ',this.trading)
      if (this.trading) {
        //确认是否有未结订单，参数为false，不需要取消未结订单
        logger.debug('正在确认是否有未结订单')
        if (await this.checkActiveOrder(false) == false) {
          //存在未结订单
          await Sleep(5000)
          return false
        } else {
          this.trading = false
          this.Account = await this.getAccount()
          this.MaxProfit = BigNumber(0)
          this.MinProfit = BigNumber(0)
        }
      }
      //计算动态盈亏
      var openProfit = BigNumber(0)
      if (this.MODE == RUN_MODE.REALTIME) {
        if (this.Account.BUY_btc.isGreaterThan(0)) {
          openProfit = lastPrice.minus(this.Account.BUY_Price).multipliedBy(this.Account.BUY_btc)
        } else if (this.Account.SELL_btc.isGreaterThan(0)) {
          openProfit = this.Account.SELL_Price.minus(lastPrice).multipliedBy(this.Account.SELL_btc)
        }
      } else {
        openProfit = debugApi.getProfit(lastPrice)
      }

      //每30秒输出一次盈亏，刷新一下账号信息
      if (nowTime - this.profitTime > 60000) {
        this.Account = await this.getAccount()
        console.log({
          BUY_btc: this.Account.BUY_btc.toFixed(6),
          SELL_btc: this.Account.SELL_btc.toFixed(6),
          BUY_Price: this.Account.BUY_Price.toFixed(0),
          SELL_Price: this.Account.SELL_Price.toFixed(0),
          Asset: this.Account.CollateralJPY.plus(this.Account.Profit).toString(),
          Profit: openProfit.toFixed(0),
          MaxProfit: this.MaxProfit.toFixed(0),
          MinProfit: this.MinProfit.toFixed(0),
          Trend: this.crossPoint
        })
        console.log('diffMACD -1,-2,-3 = ',this.diffMACD[this.diffMACD.length - 1] , this.diffMACD[this.diffMACD.length - 2],this.diffMACD[this.diffMACD.length - 3])
        this.profitTime = nowTime
        this.preProfit = openProfit

        //检查是否有未结订单，有则取消
        //如果刚刚交易过，则交易后3分钟检查，否则每分钟检查
        if (nowTime - this.tradingTime > 120000 && await this.checkActiveOrder(true) == false) {
          //当返回值为false则表示存在未结订单，且正进行异步取消订单操作,设置为交易中状态，等待1秒后返回
          this.trading = true
          await Sleep(2000)
          return false
        }
      }

      //止盈*止损*平衡保证金 
      try {
        //SFD发生时不操作
        var lastBTCPrice = BigNumber(this.BTC_prices[this.BTC_prices.length - 1])
        if ((lastBTCPrice).div(lastPrice).minus(1).isGreaterThan(0.05)) {
          return false
        }

        if (this.Account.BUY_btc.comparedTo(0) != 0) {
          absBTC = this.Account.BUY_btc
        }
        if (this.Account.SELL_btc.comparedTo(0) != 0) {
          absBTC = this.Account.SELL_btc
        }

        this.profitStopJPY = this.Account.CollateralJPY.multipliedBy(this.Lever).multipliedBy(profitStopJPYRate)
        
        //如果盈利为负，
        if (openProfit.isLessThan(0)) {
          //当保证金维持率低于最低维持率时，卖出 止损
          if (this.Account.CollateralJPY.plus(openProfit).div(this.Account.Require_JPY).isLessThan(requireRateMin) ) {
            if (this.balanceTimes <= 3){
              dtBtc = BigNumber(Min_Stock)
              logprofit.info('低于最低维持率, 减仓 0.01 Btc', ' Price=', lastPrice.toFixed(0), ' openProfit=', openProfit.toFixed(0))
              this.balanceTimes++
            }else{
              dtBtc = absBTC
              logprofit.info('低于最低维持率, 清仓Btc', ' Price=', lastPrice.toFixed(0), ' openProfit=', openProfit.toFixed(0))
              this.balanceTimes = 1
            }            
          }
        }

        if (openProfit.isGreaterThan(this.MaxProfit)) {
          this.MaxProfit = BigNumber(openProfit.toString())
          logprofit.info('MaxProfit=', this.MaxProfit.toFixed(0))
        }
        if (openProfit.isLessThan(this.MinProfit)){
          this.MinProfit = BigNumber(openProfit.toString())
          logprofit.info('MinProfit=', this.MinProfit.toFixed(0))
        }

        // //止损策略
        // if (dtBtc.comparedTo(0) == 0 && absBTC.isGreaterThan(0) && openProfit.isLessThan(0)
        //   && this.MinProfit.abs().isGreaterThan(this.profitStopJPY.multipliedBy(0.5)) 
        // ) {
        //   dtBtc = absBTC
        //   logprofit.info('MinProfit=', this.MinProfit.toFixed(0), 'openProfit=', openProfit.toFixed(0))
        //   if (dtBtc.isGreaterThan(Min_Stock)) {
        //     logprofit.info('亏损过大导致离场：dtBtc=', dtBtc.abs().toFixed(6), ' Price=', lastPrice.toFixed(0), ' StopPrice=', this.profitStopJPY.toFixed(0))
        //   }
        // }

        //历史最大盈利超7%且当前盈利回撤到历史最大盈利的8成以下，提盈
        if (dtBtc.comparedTo(0) == 0 && dtBtc.abs().isLessThan(Min_Stock)
          && absBTC.isGreaterThan(0) && openProfit.isGreaterThan(0)
          && ((this.MaxProfit.isGreaterThan(this.profitStopJPY) && this.MaxProfit.isGreaterThan(openProfit.plus(this.profitStopJPY.idiv(10)))) || (this.MaxProfit.isGreaterThan(this.Account.Require_JPY.multipliedBy(0.07)) && this.MaxProfit.multipliedBy(0.8).isGreaterThan(openProfit)))
        ) {
          dtBtc = absBTC
          logprofit.info('MaxProfit=', this.MaxProfit.toFixed(0), 'openProfit=', openProfit.toFixed(0))
          if (dtBtc.isGreaterThan(Min_Stock)) {
            logprofit.info('盈利回撤导致离场：dtBtc=', dtBtc.abs().toFixed(6), ' Price=', lastPrice.toFixed(0), ' StopPrice=', this.profitStopJPY.toFixed(0))
          }
        }

        //避免突转急下的行情：1分钟内的价格突变达到了单价的千分之5时立即退出
        var lastMinute_Close = this.K[this.K.length - 1].Close
        if (this.Account.BUY_btc.isGreaterThan(0) && lastPrice.isLessThan(lastMinute_Close) && lastPrice.multipliedBy(0.006).isLessThan(lastPrice.minus(lastMinute_Close).multipliedBy(-1))) {
          dtBtc = this.Account.BUY_btc
          if (dtBtc.isGreaterThan(Min_Stock))
            logprofit.info('价格突变导致离场：dtBtc=', dtBtc.abs().toFixed(6), ' Price=', lastPrice.toFixed(0))
        }
        if (this.Account.SELL_btc.isGreaterThan(0) && lastPrice.isGreaterThan(lastMinute_Close) && lastPrice.multipliedBy(0.006).isLessThan(lastPrice.minus(lastMinute_Close))) {
          dtBtc = this.Account.SELL_btc
          if (dtBtc.isGreaterThan(Min_Stock))
            logprofit.info('价格突变导致离场：dtBtc=', dtBtc.abs().toFixed(6), ' Price=', lastPrice.toFixed(0))
        }

        // var useableProfit = openProfit.minus(this.Account.Require_JPY.multipliedBy(requireRateMin)) 
        var useableJPY = this.Account.CollateralJPY.plus(openProfit).minus(this.Account.Require_JPY.multipliedBy(requireRateMax)).multipliedBy(this.Lever).idiv(requireRateMax)

        if (absBTC.isGreaterThan(0) && dtBtc.abs().isGreaterThanOrEqualTo(Min_Stock)) {
          var side = this.Account.BUY_btc.comparedTo(0) == 0 ? 'SELL' : 'BUY'

          if (dtBtc.abs().isGreaterThanOrEqualTo(Min_Stock)) {
            this.trading = true
            this.tradingTime = new Date().getTime()
            if (side == 'BUY') {
              if (dtBtc.isGreaterThan(0)) {
                logger.debug('SELL ', '数量 ', dtBtc.abs().toFixed(6), ' Price 市价')
                logprofit.info('SELL ', '数量 ', dtBtc.abs().toFixed(6), ' Price 市价')
                if (this.MODE == RUN_MODE.REALTIME)
                  var orderID = await this.sendOrder('SELL', dtBtc.abs().toFixed(6), null)
                if (this.MODE == RUN_MODE.DEBUG)
                  var orderID = debugApi.sendOrder('SELL', dtBtc.abs().toFixed(6), this.askPrice)
              }
              if (dtBtc.isLessThan(0)) {
                logger.debug('BUY ', '数量 ', dtBtc.abs().toFixed(6), ' Price 市价')
                logprofit.info('BUY ', '数量 ', dtBtc.abs().toFixed(6), ' Price 市价')
                if (this.MODE == RUN_MODE.REALTIME)
                  var orderID = await this.sendOrder('BUY', dtBtc.abs().toFixed(6), null)
                if (this.MODE == RUN_MODE.DEBUG)
                  var orderID = debugApi.sendOrder('BUY', dtBtc.abs().toFixed(6), this.bidPrice)
              }
            } else if (side == 'SELL') {
              if (dtBtc.isGreaterThan(0)) {
                logger.debug('BUY ', '数量 ', dtBtc.abs().toFixed(6), ' Price 市价')
                logprofit.info('BUY ', '数量 ', dtBtc.abs().toFixed(6), ' Price 市价')
                if (this.MODE == RUN_MODE.REALTIME)
                  var orderID = await this.sendOrder('BUY', dtBtc.abs().toFixed(6), null)
                if (this.MODE == RUN_MODE.DEBUG)
                  var orderID = debugApi.sendOrder('BUY', dtBtc.abs().toFixed(6), this.bidPrice)
              }
              if (dtBtc.isLessThan(0)) {
                logger.debug('SELL ', '数量 ', dtBtc.abs().toFixed(6), ' Price 市价')
                logprofit.info('SELL ', '数量 ', dtBtc.abs().toFixed(6), ' Price 市价')
                if (this.MODE == RUN_MODE.REALTIME)
                  var orderID = await this.sendOrder('SELL', dtBtc.abs().toFixed(6), null)
                if (this.MODE == RUN_MODE.DEBUG)
                  var orderID = debugApi.sendOrder('SELL', dtBtc.abs().toFixed(6), this.askPrice)
              }
            }
            if (this.MODE == RUN_MODE.REALTIME && orderID) {
              this.confirmOrderList.push(orderID)
            }
            if (this.MODE == RUN_MODE.DEBUG) {
              this.trading = false
            }
            await Sleep(10000)
            this.confirmOrderList.every(async (el, i) => {
              //下单后确认              
              httpApi.confirmOrder(el).then(async res => {
                if (res.status == 'OK') {
                  var orders = res.data;
                  orders.forEach(el => {
                    logger.debug('交易 --- BTC ', el.size, ' Side', el.side, ' Price', el.price)
                    //logprofit.info('交易 --- BTC ', el.size, ' Side', el.side, ' Price', el.price)
                  })
                } else {
                  logger.debug('止盈止损订单确认Error', res.data)
                }
              })
              delete this.confirmOrderList[i]
            })
            this.confirmOrderList = this.confirmOrderList.filter(el => el)
          }
        }
      } catch (err) {
        this.errTimes += 1
        logger.debug('止盈代码有问题', err)
        this.Account = await this.getAccount()
        //throw err
      }

      /// EMA
      if (false) {
        var timePeriod = this.marketData.close.length > 99 ? 99 : this.marketData.close.length - 10
        var emaData = this.marketData.close//.slice()
        //emaData.push(this.prices[this.prices.length - 1])
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

        var EMA_length = EMA9.length// <= 180 ? EMA9.length : 180;
        var EMA51 = EMA5.slice(-EMA_length)
        var EMA91 = EMA9.slice(-EMA_length)

        crossResult = Cross(EMA51, EMA91)
      }

      var trendPolicy = {
        id: 1,
        name: 'MACD趋势策略'
      }
      var usePolicy = 1
      var lastK = this.K[this.K.length - 1]
      var lastK_2 = this.K[this.K.length - 2]
      var lastK_3 = this.K[this.K.length - 3]
      var lastK_30 = this.K_30[this.K_30.length - 1]
      /// 根据MACD判断多空趋势，以1分钟K线判断入场时机
      /// 入场后执行上面的止盈止损策略
      /// 另外单独增加退出时机判断
      if (usePolicy == trendPolicy.id && lastK_30 != this.tempM30K) {
        ///MACD
        var macdData = this.K_30.map(function (item) { return item.Close })
        //console.log(macdData)
        var MACD = talib.MACD(macdData, 12, 26, 9, 0)
        //console.log(MACD)
        var fastMACD = MACD[0]
        var slowMACD = MACD[1]
        this.diffMACD = MACD[2]
        var MACD_length = slowMACD.length// <= 180 ? EMA9.length : 180;
        var fastMACD1 = fastMACD.slice(-MACD_length)
        var slowMACD1 = slowMACD.slice(-MACD_length)
        var MacdCrossResult = Cross(fastMACD1, slowMACD1)
        this.crossPoint = MacdCrossResult[0] //交叉位置
      }

      //常规判断
      var sinceLastCrossK = this.K.slice(this.K.length - 6)
      var bullCount = sinceLastCrossK.reduce((total, currentValue, currentIndex, arr) => { return total + parseInt(currentValue.Close > currentValue.Open ? 1 : 0) }, 0)
      var bearCount = sinceLastCrossK.reduce((total, currentValue, currentIndex, arr) => { return total + parseInt(currentValue.Close < currentValue.Open ? 1 : 0) }, 0)
      var lastPriceInMinuteTime = new Date().getTime()-60000
      var i = 1
      var lastPriceInMinute = []
      while(i < this.exec_WriteBuff.length && new Date(this.exec_WriteBuff[this.exec_WriteBuff.length-i].exec_date).getTime() > lastPriceInMinuteTime){
        // console.log(i,this.exec_WriteBuff[this.exec_WriteBuff.length-i].price,new Date(this.exec_WriteBuff[this.exec_WriteBuff.length-i].exec_date).getTime(),lastPriceInMinuteTime)
        lastPriceInMinute.push(this.exec_WriteBuff[this.exec_WriteBuff.length-i].price)
        i++
      }
      var maxPriceInMinute = max(lastPriceInMinute)
      var minPriceInMinute = min(lastPriceInMinute)
      //上涨时
      if (this.crossPoint > 0) {
        //console.log(this.diffMACD.slice(this.diffMACD.length - 4))
        //判断趋势是否稳定，连续4个diff值符合趋势才算稳定
        if (this.diffMACD[this.diffMACD.length - 1] > this.diffMACD[this.diffMACD.length - 2] 
          //&& this.diffMACD[this.diffMACD.length - 2] > this.diffMACD[this.diffMACD.length - 3]  
          && lastPrice.isGreaterThan(lastK_30.Close)
          //&& this.diffMACD[this.diffMACD.length - 3] > this.diffMACD[this.diffMACD.length - 4]
        ) {
          if (lastK_30 != this.tempM30K) {
            logger.debug('发现金叉，开始寻找买入时机--------------', new Date(lastK.Time).Format('yyyy-MM-dd hh:mm'))
          }

          if (bullCount >= 3 && lastPrice.isGreaterThanOrEqualTo(maxPriceInMinute) && lastPrice.isGreaterThan(lastK_30.Close)
            && ((lastPrice.isGreaterThan(lastK.Close) && lastK.Close > lastK.Open) || (lastPrice.isGreaterThan(lastK_2.Close) && lastK_2.Close > lastK_2.Open))
            || (lastPrice.isGreaterThan(lastMinute_Close) && lastPrice.minus(lastMinute_Close).isGreaterThan(lastPrice.multipliedBy(0.005)))
          ) {
            //进入到这一步，意味着趋势已经确认
            //再进行买入时机判断
            tradeSide = 'BUY'
            tradeAmount = this.Account.SELL_btc.comparedTo(0) != 0 ? this.Account.SELL_btc : useableJPY.div(this.bidPrice)
            if (tradeAmount.isGreaterThan(Min_Stock)) {
              logprofit.debug('买入+++++btc =', tradeAmount.toFixed(6))
              console.log('diffMACD -1,-2,-3 = ',this.diffMACD[this.diffMACD.length - 1] , this.diffMACD[this.diffMACD.length - 2],this.diffMACD[this.diffMACD.length - 3])
            } else {
              // logger.debug('由于仓位已满所以放弃买入--------------', new Date(lastK.Time).Format('yyyy-MM-dd hh:mm'))
              // //this.Account = await this.getAccount()
              // logger.debug({
              //   BUY_btc: this.Account.BUY_btc.toFixed(6),
              //   SELL_btc: this.Account.SELL_btc.toFixed(6),
              //   Asset: this.Account.CollateralJPY.plus(this.Account.Profit).toString(),
              //   Profit: this.Account.Profit.toFixed(0),
              //   useableJPY: useableJPY.toFixed(6)
              // })
            }
          }
        }
      }
      
      if (this.crossPoint < 0 ) {
        //console.log(this.K_30[this.K_30.length-1],this.K_30[this.K_30.length-2],this.K_30[this.K_30.length-3])        
        if (this.diffMACD[this.diffMACD.length - 1] < this.diffMACD[this.diffMACD.length - 2] 
         // && this.diffMACD[this.diffMACD.length - 2] < this.diffMACD[this.diffMACD.length - 3] 
         && lastPrice.isLessThan(lastK_30.Close)
          //&& this.diffMACD[this.diffMACD.length - 3] < this.diffMACD[this.diffMACD.length - 4]
        ) {
          if (lastK_30 != this.tempM30K) {
            logger.debug('发现死叉，开始寻找卖出时机--------------', new Date(lastK.Time).Format('yyyy-MM-dd hh:mm'))
          }
          //空头仓位为空时才卖出
          // if(lastPrice.isLessThanOrEqualTo(minPriceInMinute)){
          //   console.log('刷新了最低价')
          // }
          if (bearCount >= 3 && lastPrice.isLessThanOrEqualTo(minPriceInMinute) && lastPrice.isLessThan(lastK_30.Close)
            && ((lastPrice.isLessThan(lastK.Close) && lastK.Close < lastK.Open) || (lastPrice.isLessThan(lastK_2.Close) && lastK_2.Close < lastK_2.Open))
            || (lastPrice.isLessThan(lastMinute_Close) && BigNumber(lastMinute_Close).minus(lastPrice).isGreaterThan(lastPrice.multipliedBy(0.005)))
          ) {
            tradeSide = 'SELL'
            tradeAmount = this.Account.BUY_btc.comparedTo(0) != 0 ? this.Account.BUY_btc : useableJPY.div(this.askPrice)
            if (tradeAmount.isGreaterThan(Min_Stock)) {
              console.log('diffMACD -1,-2,-3 = ',this.diffMACD[this.diffMACD.length - 1] , this.diffMACD[this.diffMACD.length - 2],this.diffMACD[this.diffMACD.length - 3])
              logprofit.debug('卖出-----btc =', tradeAmount.toFixed(6))
            } else {
              // logger.debug('由于仓位已满所以放弃卖出--------------', new Date(lastK.Time).Format('yyyy-MM-dd hh:mm'))
              // //this.Account = await this.getAccount()
              // logger.debug({
              //   BUY_btc: this.Account.BUY_btc.toFixed(6),
              //   SELL_btc: this.Account.SELL_btc.toFixed(6),
              //   Asset: this.Account.CollateralJPY.plus(this.Account.Profit).toString(),
              //   Profit: this.Account.Profit.toFixed(0),
              //   useableJPY:useableJPY.toFixed(6)
              // })
            }
          }
        }
      }
      
      var sinceLastDiff = this.diffMACD.slice(this.diffMACD.length - 3)
      var diffCount = sinceLastDiff.reduce((total, currentValue, currentIndex, arr) => { return currentIndex == 0 ? 0 : total + parseInt(currentValue > arr[currentIndex - 1] ? 1 : 0) }, 0)
      //最新的diff与趋势向反 ，清仓退出
      if (this.Account.BUY_btc.isGreaterThan(0)) {
        //最近的5个macddiff多头数量少于2个(4和4个以上才会清仓)
        //低于1000的diff可以认为是信号不明确,大于1000才是明确信号
        if (((this.crossPoint > 0 && Math.abs(this.diffMACD[this.diffMACD.length - 1]) < 1000) || this.crossPoint > 0 && diffCount < 1 ) && lastPrice.isLessThan(lastK_30.Close) && lastPrice.isLessThanOrEqualTo(minPriceInMinute) ) {
          tradeSide = 'SELL'
          tradeAmount = this.Account.BUY_btc
          logprofit.debug('由于趋势由强转弱而退出，diffCount=',diffCount, new Date().Format('yyyy-MM-dd hh:mm'))
          console.log('diffMACD -1,-2,-3 = ',this.diffMACD[this.diffMACD.length - 1] , this.diffMACD[this.diffMACD.length - 2],this.diffMACD[this.diffMACD.length - 3])
        }
      }
      if (this.Account.SELL_btc.isGreaterThan(0)) {
        if (((this.crossPoint < 0 && Math.abs(this.diffMACD[this.diffMACD.length - 1]) < 1000) || this.crossPoint < 0 && diffCount >= 2 ) && lastPrice.isGreaterThan(lastK_30.Close) && lastPrice.isGreaterThanOrEqualTo(maxPriceInMinute)) {
          tradeSide = 'BUY'
          tradeAmount = this.Account.SELL_btc
          logprofit.debug('由于趋势由强转弱而退出，diffCount=',diffCount, new Date().Format('yyyy-MM-dd hh:mm'))
          console.log('diffMACD -1,-2,-3 = ',this.diffMACD[this.diffMACD.length - 1] , this.diffMACD[this.diffMACD.length - 2],this.diffMACD[this.diffMACD.length - 3])
        }
      }

      //K线不刷新则退出
      if (lastK == this.tempLastK) {
        //return
      } else {
        this.tempM30K = lastK_30
        this.tempLastK = lastK
      }
      if (tradeAmount.isLessThan(Min_Stock)) {
        //console.log(this.numTick)
        return true
      }

      try {
        if (tradeSide != '' && tradeAmount.isGreaterThanOrEqualTo(Min_Stock)) {
          var minTradingStock = BigNumber(Min_Stock).multipliedBy(5)
          this.trading = true
          this.balanceTimes = 1
          this.tradingTime = new Date().getTime()
          var Amount = tradeAmount
          tradePrice = null//tradeSide == 'BUY' ? this.bidPrice : this.askPrice
          logger.debug('将要下单 ', tradeSide, '数量=', tradeAmount.toString(), ' price参考', tradeSide == 'BUY' ? this.bidPrice : this.askPrice, new Date(lastK.Time).Format('yyyy-MM-dd hh:mm'))
          logprofit.info('将要下单 ', tradeSide, '数量=', tradeAmount.toString(), ' price参考', tradeSide == 'BUY' ? this.bidPrice : this.askPrice, new Date(lastK.Time).Format('yyyy-MM-dd hh:mm'))
          //var acc = await this.getAccount()
          //logprofit.info('下测试单之前 保证金=',acc.Require_JPY.toFixed(0),' Buy:',acc.BUY_btc.toFixed(6), 'SELL ',acc.SELL_btc.toFixed(6))
          while (tradeAmount.isGreaterThan(0)) {
            if (tradeAmount.isGreaterThan(minTradingStock.plus(Min_Stock))) {
              tradeAmount = tradeAmount.minus(minTradingStock)
              Amount = BigNumber(minTradingStock)
            } else {
              Amount = tradeAmount
              tradeAmount = BigNumber(0)
            }

            //下单
            if (this.MODE == RUN_MODE.REALTIME) {
              var orderID = await this.sendOrder(tradeSide, Amount.toString(), tradePrice)
              this.confirmOrderList.push(orderID)
            }
            else {
              var orderID = debugApi.sendOrder(tradeSide, Amount.toString(), tradePrice)
              this.trading = false
            }
            await Sleep(500)
          }

          this.confirmOrderList.every(async (el, i) => {
            //下单后确认
            await Sleep(500)
            httpApi.confirmOrder(el).then(async res => {
              if (res.status == 'OK') {
                var orders = res.data;
                orders.forEach(el => {
                  logger.debug('交易 --- BTC ', el.size, ' Side', el.side, ' Price', el.price)
                  //logprofit.info('交易 --- BTC ', el.size, ' Side', el.side, ' Price', el.price)
                })
              } else {
                logger.debug('交易后订单确认Error', res.data)
              }
            })
            delete this.confirmOrderList[i]
          })

          //await Sleep(500)
          this.confirmOrderList = this.confirmOrderList.filter(el => el)
          this.Account = await this.getAccount()
          this.MaxProfit = BigNumber(0)
          this.MinProfit = BigNumber(0)
          //logprofit.info('下测试单之后 保证金=',acc.Require_JPY.toFixed(0),' Buy:',acc.BUY_btc.toFixed(6), 'SELL ',acc.SELL_btc.toFixed(6))
          this.numTick = 0
          //tradeTime++
        }
      }
      catch (err) {
        logger.debug('交易代码有问题', err)
        this.errTimes++
        await Sleep(200)
        this.Account = await this.getAccount()
        //throw err
        return
      }
      return { side: tradeSide, tradeAmount: tradeAmount }
    }
    catch (err) {
      //throw err
      logger.debug(err)
      this.errTimes += 1
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
    if (this.MODE != RUN_MODE.REALTIME && this.MODE != RUN_MODE.DEBUG) {
      return
    }
    if (this.MODE == RUN_MODE.DEBUG) {
      return
    }
    let currentName = ''
    if (filetype == 'record') {
      var dataBuff = this.BTC_K_WriteBuff
    }
    if (filetype == 'BTC_FX_Executions') {
      var dataBuff = this.exec_WriteBuff
    }
    if (filetype == 'BTC_Executions') {
      var dataBuff = []// this.BTC_EXEC_WriteBuff
    }
    while (true && this.isRunning) {
      if (dataBuff[0] == undefined) {
        //console.log('@375',dataBuff)
        if (filetype == 'record') await Sleep(1000 * 60)
        if (filetype == 'BTC_FX_Executions') await Sleep(200)
        if (filetype == 'BTC_Executions') await Sleep(200)
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