const { parentPort, MessagePort } = require('worker_threads');

var port



var _prices = [] // 历史成交价格
var _vol = [] //历史成交量
var _burstPrice // 突破价格点差
var _tickPrice //本轮tick价格
var bull //做多
var bear //做空
var _tradeAmount //交易数量
var Burst_Threshold_Value //价格突破时成交金额考量阈值 小于此阈值意味着价格突破时成交金额过小，成功率会较低 初始值为1万美元
var Min_Stock //最小交易金额 预设为0.01
var orderBook
var _bidPrice
var _askPrice

parentPort.on('message', (data) => {
    port = data.port;
    //port.postMessage('heres your message!');
    var prices = data.executions
    prices.forEach(element => {
        _prices.shift();
        _prices.push(element.price)
        _vol.shift();
        _vol.push(element.size)
    });
});

function tradingLogic() {
    var numTick
    var checkLen = 6
    var LTP = LTP
    var LHP = _.max(_prices.slice(_prices.length - checkLen, -1))//上一轮tick的历史最高价
    var LHP2 = _.max(_prices.slice(_prices.length - checkLen - 1, -2)) //上上一轮tick的历史最高价
    var LLP = _.min(_prices.slice(_prices.length - checkLen, -1))//上一轮tick的历史最低价
    var LLP2 = _.min(_prices.slice(_prices.length - checkLen - 1, -2))//上上一轮tick的历史最低价


    // 趋势策略，价格出现方向上的突破时开始交易
    // 最新成交价比之上一个tick的历史高点产生突破，或者比之上上个tick的历史最高价产生突破，且比上一个tick的成交价更高
    if (LTP - LHP > _burstPrice || LTP - LHP2 > _burstPrice && LTP > _prices[-2]) {
        bull = true
        _tradeAmount = cny / bidPrice * 0.99
    }// 反之，向下突破时开始交易
    if (LTP - LLP < -_burstPrice || LTP - LLP2 < -_burstPrice && LTP < _prices[-2]) {
        bear = true
        _tradeAmount = btc
    }

    if ((!bull && !bear) || _tradeAmount < MinStock) {
        Sleep(1000 * 30)
        return
    }

    // 下单力度计算
    //  1. 小成交量的趋势成功率比较低，减小力度
    //  2. 过度频繁交易有害，减小力度
    //  N. 小于或高于历史最高（最低）价时减小力度
    //  3. 短时价格波动过大，减小力度
    //  4. 盘口价差过大，减少力度
    if (_vol * _tickPrice < Burst_Threshold_Value) _tradeAmount *= _vol * _tickPrice / Burst_Threshold_Value
    if (numTick < 5) _tradeAmount *= 0.8
    if (numTick < 10) _tradeAmount *= 0.8
    if (bull && _tickPrice < _.max(_prices)) _tradeAmount *= 0.90
    if (bear && _tickPrice > _.min(_prices)) _tradeAmount *= 0.90
    if (Math.abs(_tickPrice - _prices[_prices.length - 2]) > _burstPrice * 2) _tradeAmount *= 0.90
    if (Math.abs(_tickPrice - _prices[_prices.length - 2]) > _burstPrice * 3) _tradeAmount *= 0.90
    if (Math.abs(_tickPrice - _prices[_prices.length - 2]) > _burstPrice * 4) _tradeAmount *= 0.90
    if (orderBook.Asks[0].Price - orderBook.Bids[0].Price > _burstPrice * 2) _tradeAmount *= 0.90
    if (orderBook.Asks[0].Price - orderBook.Bids[0].Price > _burstPrice * 3) _tradeAmount *= 0.90
    if (orderBook.Asks[0].Price - orderBook.Bids[0].Price > _burstPrice * 4) _tradeAmount *= 0.90

    // 执行订单
    // BitFlyer订单状态
    // ACTIVE: open orders
    // COMPLETED: fully completed orders
    // CANCELED: orders that have been cancelled by the customer
    // EXPIRED: order that have been cancelled due to expiry
    // REJECTED: failed orders

    var tradePrice = bull ? _bidPrice : _askPrice
    while (_tradeAmount >= Min_Stock) {
        // 下单，考虑设置time_in_force参数为IOC（立即成交否则取消）
        var orderId = bull ? exchange.Buy(_bidPrice, _tradeAmount) : exchange.Sell(_askPrice, _tradeAmount)

        Sleep(200)
        if (orderId) {
            _tradeOrderId = orderId
            var order = null

            //下单后等待200毫秒就尝试取消订单，估计是当部分成交后主动取消其余为成交部分，
            //可能是原来的交易所不支持立即成交否则自动取消这种类型的订单
            while (true) {
                order = exchange.GetOrder(orderId)
                if (order) {
                    if (order.Status == ORDER_STATE_PENDING) {
                        exchange.CancelOrder(orderId)
                        Sleep(200)
                    } else {
                        break
                    }
                }
            }
            _tradeOrderId = 0
            tradeAmount -= order.DealAmount
            if (order.Status == ORDER_STATE_CLOSED && order.DealAmount != 0) {
                _orders.push(order)
            }
            tradeAmount *= 0.9
            _updateProfit()
            if (order.Status == ORDER_STATE_CANCELED) {
                _updateOrderBook()
                while (bull && _bidPrice - tradePrice > 0.1) {
                    tradeAmount *= 0.99
                    tradePrice += 0.1
                }
                while (bear && _askPrice - tradePrice < -0.1) {
                    tradeAmount *= 0.99
                    tradePrice -= 0.1
                }
            }
        }
    }
    numTick = 0
}
